const expect = require('chai').expect

const mongoose = require('mongoose')
mongoose.Promise = global.Promise

const Mockgoose = require('mockgoose').Mockgoose
const mockgoose = new Mockgoose(mongoose)

before(async () => {
  await mockgoose.prepareStorage()
  await mongoose.connect('mongodb://localhost')
})

// Mocks
const Payload = require('../mocks/payload-schema')
const Helper = require('./helper.js')

// Class under test
const MongooseQueue = require('../index').MongooseQueue

const JobSchema = require('../index').JobSchema
const Job = JobSchema('queue', mongoose.Schema.Types.ObjectId)

describe('MongooseQueue', () => {
  describe('constructor', () => {
    it('should set default options', () => {
      const queue = new MongooseQueue('payload', '123456789')

      expect(queue.options.queueCollection).to.equal('queue')
      expect(queue.options.payloadRefType).to.equal(mongoose.Schema.Types.ObjectId)
      expect(queue.options.blockDuration).to.equal(30000)
      expect(queue.options.maxRetries).to.equal(5)
    })
  })

  describe('add', () => {
    let mongooseQueue = null

    before(() => {
      mongooseQueue = new MongooseQueue('payload', '123456789')
    })

    after(async () => {
      // remove all elements from queue
      await Job.remove({})
    })

    it('should accept a mongoose documents as payload', async () => {
      // create a sample payload object
      const samplePayload = new Payload({
        first: 'First element',
        second: 'Second element'
      })
      const savedPayload = await samplePayload.save()

      // add document to queue
      const jobId = await mongooseQueue.add(savedPayload)
      expect(jobId).to.not.be.null

      // test if document inserted
      const queuedJob = await Job.findById(jobId)
      expect(queuedJob.payload.toString()).to.equal(savedPayload._id.toString())
    })

    it('should fail if no payload is provided', async () => {
      try {
        await mongooseQueue.add(null)
      } catch (e) {
        expect(e).to.equal('Payload missing.')
      }
    })

    it('should fail when payload is no Mongoose document', async () => {
      try {
        await mongooseQueue.add({invalid: 'object'})
      } catch (e) {
        expect(e).to.equal('Payload is not a valid Mongoose document.')
      }
    })
  })

  describe('jobs', () => {
    const maxRetries = 5

    let jobs = []
    let mongooseQueue = null
    let payload = null

    before(async () => {
      mongooseQueue = new MongooseQueue('payload', '1234567890', {
        maxRetries: maxRetries
      })

      // create some sample payloads
      payload = await Helper.randomPayload().save()

      jobs = await Helper.makeJobs([
        { payload: payload._id },
        { 
          payload: payload._id,
          done: true
        },
        {
          payload: payload._id,
          error: 'Error message',
          done: true
        },
        {
          payload: payload._id,
          retries: maxRetries + 1
        }
      ], Job)
    })

    after(async () => {
      await Job.remove({})
    })

    describe('clean', () => {

      it('should remove all jobs marked as done/error or where the retry count is maxed out', async () => {
        await mongooseQueue.clean()
        const jobs = await Job.find({})
        expect(jobs.length).to.equal(1)
        expect(jobs[0].done).to.be.false
        expect(jobs[0].retries).to.be.below(maxRetries)
      })
    })

    describe('reset', () => {
      it('should remove all', async () => {
        await mongooseQueue.reset()
        const jobs = await   Job.find({})
        expect(jobs.length).to.equal(0)
      })
    })
  })


  describe('get', () => {
    const maxRetries = 5

    let mongooseQueue = null
    let payload = null

    before(async () => {
      mongooseQueue = new MongooseQueue('payload', '1234567890', {
        maxRetries: maxRetries
      })

      // create some sample payloads
      payload = await Helper.randomPayload().save()
    })

    describe('retries', () => {
      let job = null

      before(async () => {
        const newJob = new Job({
          payload: payload._id
        })
        job = await newJob.save()
      })

      after(async () => {
        await Job.remove({})
      })

      it('should increment retry count on get', async () => {
        const gotJob = await mongooseQueue.get()
        expect(gotJob).to.not.be.null

        const retryJob = await Job.findOne({ _id: gotJob.id })
        expect(retryJob).to.not.be.null
        expect(retryJob.retries).to.equal(1)
      })

      it('should not return job with maxed out retries', async () => {
        // manually set job retry count to max and unblock it from previous test
        job.blockedUntil = Date.now()
        job.retries = maxRetries + 1
        
        await job.save()
        
        const noJob = await mongooseQueue.get()
        expect(noJob).to.be.null
      })
    })

    describe('order', () => {
      let jobs = []

      before(async () => {
        jobs = await Helper.makeJobs([
          { payload: payload._id },
          { payload: payload._id }
        ], Job)
      })

      after(async () => {
        await Job.remove({})
      })

      it('should return the oldest job for processing', async () => {
        const job = await mongooseQueue.get()
        expect(job).to.not.be.null


        const olderJob = await Job.find({ createdAt: { $lt: job.createdAt } })
        expect(olderJob).to.be.empty
      })
    })

    describe('blocking', () => {
      let jobs = []

      before(async () => {
        jobs = await Helper.makeJobs([
          {
            blockedUntil: Date.now() + 100000000,
            payload: payload._id
          },
          { payload: payload._id }
        ], Job)
      })

      after(async () => {
        Job.remove({})
      })

      it('should return the oldest job that is not currently blocked and block it for the time set in the options', async () => {
        const job = await mongooseQueue.get()
        expect(job.blockedUntil.getTime()).to.be.above(Date.now())
      })

      it('should not return a job since all are currently blocked', async () => {
        // this call should not return a job since all are taken from the previous call
        const failJob = await mongooseQueue.get()
        expect(failJob).to.be.null
      })
    })

    describe('ack/done and error', () => {
      let jobs = []

      before(async () => {
        jobs = await Helper.makeJobs([
          {
            payload: payload._id,
            done: true
          },
          {  payload: payload._id },
          {  payload: payload._id },
          {  payload: payload._id }
        ], Job)
      })

      after(async () => {
        await Job.remove({})
      })

      it('should return the oldest job that is not marked as done', async () => {
        const job = await mongooseQueue.get()
        expect(job).to.not.be.null
        expect(job.id.equals(jobs[1]._id)).to.be.true
      })

      it('ack() should mark the job as done when ack was called', async () => {
        const job = await mongooseQueue.get()
        expect(job).to.not.be.null
        expect(jobs[2]._id.equals(job.id)).to.be.true

        const ackJob = await mongooseQueue.ack(job.id)
        expect(ackJob).to.not.be.null
        expect(jobs[2]._id.equals(ackJob.id)).to.be.true
        expect(ackJob.done).to.be.true
      })

      it('ack() should fail when jobId is invalid', async () => {
        try {
          await mongooseQueue.ack('57a9a8c526f9c3c114f00000')
        } catch (e) {
          expect(e).to.equal('Job id invalid, job not found.')
        }
      })

      it('error() should save the job as failed and mark it as done', async () => {
        const job = await mongooseQueue.get()
        expect(job).to.not.be.null
        expect(jobs[3]._id.equals(job.id)).to.be.true

        const errorJob = await mongooseQueue.error(job.id, 'Job failed')
        expect(errorJob).to.not.be.null
        expect(jobs[3]._id.equals(errorJob.id)).to.be.true
        expect(errorJob.done).to.be.true
        expect(errorJob.error).to.equal('Job failed')
      })

      it('error() should fail when jobId is invalid', async () => {
        try {
          await mongooseQueue.error('57a9a8c526f9c3c114f00000', 'failed')
        } catch (e) {
          expect(e).to.equal('Job id invalid, job not found.')
        }
      })

      it('should return null, when no undone job is found', async () => {
        // manually mark all jobs as done
        await Job.update({}, { $set: {  done: true } })
        
        const noJob = await mongooseQueue.get()
        expect(noJob).to.be.null
      })
    })
  })
})
