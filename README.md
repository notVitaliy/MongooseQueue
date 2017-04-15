# MongooseQueue

MongooseQueue is a NodeJS package that allows managing and processing Mongoose documents as payload in a queue.
Feel free to contribute and share issues you find or features you'd like to see.

## Requirements
- ES6
- Node 7.6+

## Usage

### General
When a job is fetched from the queue by calling the get method it is blocked for a certain amount of time from being picked up by other instances. For long running jobs make sure the blockDuration in the options passed to the constructor is set accordingly.

### Initialization
```javascript
const MongooseQueue = require('mongoose-queue').MongooseQueue;
```

### Class instantiation
Instantiate the class by calling the constructor:
```javascript
const mongooseQueue = new MongooseQueue(payloadModel, workerId = '', options = {})
```
#### Parameters
- payloadModel: The name of the Mongoose model used as payload.
- workerId: A custom name for this instance/worker of the queue. Defaults to ''.
- options: Additional options to configure the instance.
  - payloadRefType: The mongoose type used for the _id field of your payload schema. Defaults to ObjectId.
  - queueCollection: Name of the queues model/collection. Defaults to 'queue'.
  - blockDuration: Time in ms a job is blocked, when a worker fetched it from the queue. Defaults to 30000.
  - maxRetries: Maximum number of retries until a job is considered failed. Defaults to 5.
#### Example
```javascript
const myOptions = {
  payloadRefType: mongoose.Types.UUID,
  queueCollection: 'queue',
  blockDuration: 30000,
  maxRetries: 5
}
const myQueue = new MongooseQueue('payload', 'my-worker-id', myOptions);
```

### Adding a job to the queue
To add a job to the queue call the method:
```javascript
MongooseQueue.add(payload)
```
#### Parameters
- payload: The Mongoose document to use as payload for this job. The model of the document has to correspond to the payload model defined upon instantiation of the class.

```javascript
const job = await MongooseQueue.add(payload)
console.log(job.id)
console.log(job.payload)
console.log(job.blockedUntil)
console.log(job.done)
```

#### Parameters
- payload: The Mongoose document to use as payload for this job. The model of the document has to correspond to the payload model defined upon instantiation of the class.


### Get a job from the queue
To get a job from the queue for processing call the method:
```javascript
MongooseQueue.get(cb)
```
When getting a job it's retries counter is incremented and it is blocked from further get requests until it's blockedUntil expires.

#### Example
```javascript
const job = await mongooseQueue.get()  
console.log(job.id)
console.log(job.payload)
console.log(job.blockedUntil)
console.log(job.done)
```

### Mark a job as completed
To mark a job as completed/finished call the method:
```javascript
MongooseQueue.ack(jobId)
```
#### Parameters
- jobId: Id of the job to mark as done/finished. Use the job id returned when getting a job for processing. 
#### Example
```javascript
const job = mongooseQueue.ack('123123123')
console.log(job.payload)
console.log(job.blockedUntil)
console.log(job.done)
```

### Mark a job with an error
To mark a job with an error (error message) call the method:
```javascript
MongooseQueue.error(jobId, error)
```
When called on a job the job is considered to be done with error. It will not be returned in subsequent get calls.
Only the latest error message is stored in the job. Subsequent calls to this method with the same job id overwrite the previous error messages.
#### Parameters
- jobId: Id of the job to mark as done/finished. Use the job id returned when getting a job for processing.
- error: Error message to store in the job. 
#### Example
```javascript
const job = await mongooseQueue.error('12312313213123', 'This one failed horribly')
console.log(job.payload)
console.log(job.blockedUntil)
console.log(job.done)
console.log(job.error)
```

### Clean the queue
Removes all jobs from the queue that are marked done (done/error) or reached the maximum retry count.
```javascript
MongooseQueue.clean()
```
The jobs affected by clean will be deleted from the queue collection in the database!
#### Example
```javascript
await mongooseQueue.clean()
console.log('The queue was successfully cleaned.')
```

### Reset the queue
Resets the entire queue by deleting ALL jobs.
```javascript
MongooseQueue.reset()
```
The queue collection in your MongoDB will be completely empty after calling this method. 
#### Example
```javascript
await mongooseQueue.reset()
console.log('The queue was completely purged of all jobs.')
```

### Multiple instances
This implementation should work, when launched on multiple instances using the same collection on the same MongoDB server.
To help identify which worker is currently processing a job, the hostname is stored alongside the worker id you provide in the class constructor. 

#### Misc
Each method returns a promise. So it's possible to use all native promise methods.
```javascript
MongooseQueue.add(payload)
  .then(job => {
    // Do something...
  })
  .catch(err) => {
    // ERROR
  }
```
