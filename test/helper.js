const Payload = require('../mocks/payload-schema');

module.exports = {
  randomPayload: () => {
    return new Payload({
      first: "asdasdasd",
      second: "asdasdadadasdas"
    })
  },
  makeJobs: async (jobs, Job) => {
    for (let i in jobs) {
      jobs[i] = new Job(jobs[i])
      await jobs[i].save()
    }

    return jobs
  }
}
