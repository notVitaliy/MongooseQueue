const mongoose = require('mongoose');
const Schema = mongoose.Schema;

let Job = null;

module.exports = (connection, collectionName, payloadRefType) => {
  if(!Job) {
    Job = new Schema({
      // time until the job is blocked for processing
      blockedUntil: {
        type: Date,
        default: Date.now(),
        required: false
      },
      // hostname of the worker currently blocking/processing the job
      workerHostname: {
        type: String,
        required: false
      },
      // Id of the worker currently blocking/processing the job
      workerId: {
        type: String,
        required: false,
      },
      // number of retries
      retries: {
        type: Number,
        default: 0,
        required: true
      },
      // Payload is a reference to another mongoose object 
      payload: {
        type: payloadRefType,
        required: true
      },
      // Is the job done or not (Does not matter if successful or not)
      done: {
        type: Boolean,
        default: false,
        required: true
      },
      // last error that occured while processing
      error: {
        type: String,
        required: false
      }
    }, {
      timestamps: true
    });
  }

  return connection.model(collectionName, Job);
}
