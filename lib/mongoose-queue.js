'use strict';

/**
 * Dependencies
 */
var os = require('os');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var _ = require('underscore');
var JobSchema = require('../schemas/job-schema');

/**
 * Implements a queue based on mongoose. 
 * 
 * @class MongooseQueue
 */
class MongooseQueue
{
	/**
	 * Creates an instance of MongooseQueue.
	 * 
	 * @param {String} payloadModel
	 * @param {string} [workerId='']
	 * @param {Object} [options={}]
	 */
	constructor(payloadModel, workerId = '', options = {})
	{
		this.payloadModel = payloadModel;

		this.workerHostname = os.hostname();
		this.workerId = workerId;

		this.options = _.defaults(options, {
			payloadRefType: Schema.Types.ObjectId,
			queueCollection: 'queue',
			blockDuration: 30000,
			maxRetries: 5
		});

		// create job model
		this.JobModel = JobSchema(this.options.queueCollection, this.options.payloadRefType);
	}

	/**
	 * Adds an element to the queue.
	 * 
	 * @param {any} payload				- The payload to attach to this job. This needs to be a Mongoose document.
	 * @param {fn(err, jobId)} cb		- Callback either returning an error or the id of the job added to the queue.
	 */
	async add(payload, cb)
	{
		// Check if async
		const isAsync = !cb || typeof cb !== 'function';

		// check if payload is a mongoose document
		let error = null;
		if(!payload)
			error = 'Payload missing.';
		else if(!payload._id)
			error = 'Payload is no valid Mongoose document.';
		
		if (error)
			return !isAsync
				? cb(new Error(error), null)
				: Promise.reject(error);

		// add to queue
		var newJob = new this.JobModel({
			payload: payload._id
		})
		
		if (!isAsync) {
			newJob.save(function(err, job)
			{
				/* istanbul ignore if */
				if(err)
					cb(err, null);
				else
					cb(null, job._id.toString());
			});
		} else {
			try {
				const job = await newJob.save();
				return job._id.toString();
			} catch (e) {
				return Promise.reject(e);
			}
		}
	}

	/**
	 * Get a job from the queue that is not done and not currentlich blocked. 
	 * 
	 * @param {fn(err, job)} cb	- Callback with error or job fetched from queue for processing.
	 */
	async get(cb)
	{
		// Check if async
		const isAsync = !cb || typeof cb !== 'function';

		// fetch the oldest job from the queue that
		// is not blocked, is not done
		// then increase blockedUntil and return it 
		const query = this.JobModel
		.findOneAndUpdate({
			blockedUntil: {$lt: Date.now()},
			retries: {$lte: this.options.maxRetries},
			done: false
		},{
			$set: {
				blockedUntil: new Date(Date.now() + this.options.blockDuration),
				workerId: this.workerId,
				workerHostname: this.workerHostname
			},
			$inc: {
				retries: 1
			},
		},{
			new: true,
			sort: {createdAt: 1}
		})
		.populate({path: 'payload', model: this.payloadModel});

		if (!isAsync) {
			query.exec(function(err, job)
			{
				/* istanbul ignore if */
				if(err)
					return cb(err, null);
				else if(!job)
					return cb(null, null);
				else
				{
					cb(null, {
						id: job._id,
						payload: job.payload,
						blockedUntil: job.blockedUntil,
						done: job.done
					});
				}
			});
		} else {
			try {
				const job = await query.exec();
				return {
					id: job._id,
					payload: job.payload,
					blockedUntil: job.blockedUntil,
					done: job.done
				};
			} catch (e) {
				return Promise.reject(e);
			}
		}
	}

	/**
	 * Mark a job as done. 
	 * 
	 * @param {String} jobId 		- Id of the job to mark as done.
	 * @param {fn(err, job)} cb		- Callback with error or updated job.
	 */
	async ack(jobId, cb)
	{
		// Check if async
		const isAsync = !cb || typeof cb !== 'function';

		const query = this.JobModel.findOneAndUpdate({
			_id: jobId
		}, {
			$set: {
				done: true
			}
		}, {
			new: true
		})

		if (!isAsync) {
			query.exec(function(err, job)
			{
				/* istanbul ignore if */
				if(err)
					return cb(err, null);
				else if(!job)
					return cb(new Error('Job id invalid, job not found.'), null);
				else
					cb(null, {
						id: job._id,
						payload: job.payload,
						blockedUntil: job.blockedUntil,
						done: job.done
					});
			});
		} else {
			try {
				const job = await query.exec();
				return {
					id: job._id,
					payload: job.payload,
					blockedUntil: job.blockedUntil,
					done: job.done
				};
			} catch (e) {
				return Promise.reject(e);
			}
		}
	}

	/**
	 * Mark a job done with an error message. 
	 * 
	 * @param {String} jobId	- Id of the job to mark with error.
	 * @param {String} error	- Error message
	 * @param {fn(err, job)} cb	- Callback with error or updated job.
	 */
	async error(jobId, error, cb)
	{
		// Check if async
		const isAsync = !cb || typeof cb !== 'function';

		const query = this.JobModel.findOneAndUpdate({
			_id: jobId
		}, {
			$set: {
				done: true,
				error: error
			}
		}, {
			new: true
		});

		if (!isAsync) {
			query.exec(function(err, job)
			{
				/* istanbul ignore if */
				if(err)
					return cb(err, null);
				else if(!job)
					return cb(new Error('Job id invalid, job not found.'), null);
				else
					cb(null, {
						id: job._id,
						payload: job.payload,
						blockedUntil: job.blockedUntil,
						done: job.done,
						error: job.error
					});
			});
		} else {
			try {
				const job = await query.exec();
				return {
					id: job._id,
					payload: job.payload,
					blockedUntil: job.blockedUntil,
					done: job.done,
					error: job.error
				};
			} catch (e) {
				return Promise.reject(e);
			}
		}
	}

	/**
	 * Removes all jobs from the queue that are marked done (done/error) or reached the maximum retry count. 
	 * 
	 * @param {fn(err)} cb - Callback with null when successful, otherwise the error is passed.
	 */
	async clean(cb)
	{
		// Check if async
		const isAsync = !cb || typeof cb !== 'function';

		const query = this.JobModel.remove({
			$or: [
				{done: true},
				{retries: {$gt: this.options.maxRetries}}
			]
		});

		if (!isAsync) {
			query.exec(function(err)
			{
				/* istanbul ignore if */
				if(err)
					return cb(err);
				else
					cb(null);
			});
		} else {
			try {
				await query.exec();
				return;
			} catch (e) {
				return Promise.reject(e);
			}
		}
	}

	/**
	 * Removes ALL jobs from the queue. 
	 * 
	 * @param {fn(err)} cb - Callback with null when successful, otherwise the error is passed.
	 */
	async reset(cb)
	{
		// Check if async
		const isAsync = !cb || typeof cb !== 'function';

		const query = this.JobModel.remove({});

		if (!isAsync) {
			query.exec(function(err)
			{
				/* istanbul ignore if */
				if(err)
					return cb(err);
				else
					cb(null);
			});
		} else {
			try {
				await query.exec();
				return;
			} catch (e) {
				return Promise.reject(e);
			}
		}
	}
}

module.exports = MongooseQueue;
