/**
 * Dependencies
 */
const os = require('os')
const mongoose = require('mongoose')
const Schema = mongoose.Schema
const JobSchema = require('../schemas/job-schema')

/**
 * Implements a queue based on mongoose.
 *
 * @class MongooseQueue
 */
class MongooseQueue {
  /**
   * Creates an instance of MongooseQueue.
   *
   * @param {String} payloadModel
   * @param {string} [workerId='']
   * @param {Object} [options={}]
   */
  constructor (payloadModel, workerId = '', options = {}) {
    this.payloadModel = payloadModel

    this.workerHostname = os.hostname()
    this.workerId = workerId

    const defaults = {
      payloadRefType: Schema.Types.ObjectId,
      queueCollection: 'queue',
      blockDuration: 30000,
      maxRetries: 5
    }

    this.options = Object.assign({}, defaults, options)

    // create job model
    this.JobModel = JobSchema(this.options.queueCollection, this.options.payloadRefType)
  }

  /**
   * Adds an element to the queue.
   *
   * @param {any} payload - The payload to attach to this job. This needs to be a Mongoose document.
   */
  async add (payload) {
    const error = !payload
      ? 'Payload missing.'
      : !payload._id
      ? 'Payload is not a valid Mongoose document.'
      : ''

    return error
      ? Promise.reject(error)
      : this._add(payload)
  }

  async _add (payload) {
    const newJob = new this.JobModel({
      payload: payload._id
    })

    try {
      const job = await newJob.save()
      return job._id.toString()
    } catch (e) {
      Promise.reject(e)
    }
  }

  /**
   * Get a job from the queue that is not done and not currentlich blocked.
   */
  async get () {
    // fetch the oldest job from the queue that
    // is not blocked, is not done
    // then increase blockedUntil and return it
    const query = this.JobModel
      .findOneAndUpdate({
        blockedUntil: { $lt: Date.now() },
        retries: { $lte: this.options.maxRetries },
        done: false
      }, {
        $set: {
          blockedUntil: new Date(Date.now() + this.options.blockDuration),
          workerId: this.workerId,
          workerHostname: this.workerHostname
        },
        $inc: {
          retries: 1
        }
      }, {
        new: true,
        sort: { createdAt: 1 }
      }
    )
    .populate({ path: 'payload', model: this.payloadModel })

    try {
      const job = await query.exec()
      return job ? this._makeJobObj(job) : null
    } catch (e) {
      return Promise.reject(e)
    }
  }

  /**
   * Mark a job as done.
   *
   * @param {String} _id - Id of the job to mark as done.
   */
  async ack (_id) {
    const query = this.JobModel
      .findOneAndUpdate({
        _id
      },
      {
        $set: { done: true }
      },
      {
        new: true
      })

    try {
      const job = await query.exec()
      return job ? this._makeJobObj(job) : null
    } catch (e) {
      return Promise.reject(e)
    }
  }

  /**
   * Mark a job done with an error message.
   *
   * @param {String} _id - Id of the job to mark with error.
   * @param {String} error - Error message
   */
  async error (_id, error) {
    const query = this.JobModel
      .findOneAndUpdate({
        _id
      },
      {
        $set: { done: true, error }
      },
      {
        new: true
      })

    try {
      const job = await query.exec()
      return job ? this._makeJobObj(job) : null
    } catch (e) {
      return Promise.reject(e)
    }
  }

  _makeJobObj (job) {
    const { _id: id, payload, blockedUntil, done, error } = job
    return { id, payload, blockedUntil, done, error }
  }

  /**
   * Removes all jobs from the queue that are marked done (done/error) or reached the maximum retry count.
   */
  async clean () {
    const query = this.JobModel
      .remove({
        $or: [
          { done: true },
          { retries: { $gt: this.options.maxRetries } }
        ]
      })

    try {
      await query.exec()
      return
    } catch (e) {
      return Promise.reject(e)
    }
  }

  /**
   * Removes ALL jobs from the queue.
   */
  async reset () {
    const query = this.JobModel.remove({})

    try {
      await query.exec()
      return
    } catch (e) {
      return Promise.reject(e)
    }
  }
}

module.exports = MongooseQueue
