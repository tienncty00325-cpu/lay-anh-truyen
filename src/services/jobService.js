const jobProgress = new Map();

function setJobProgress(jobId, data) {
  jobProgress.set(jobId, data);
}

function getJobProgress(jobId) {
  return jobProgress.get(jobId);
}

function deleteJob(jobId) {
  jobProgress.delete(jobId);
}

module.exports = {
  jobProgress,
  setJobProgress,
  getJobProgress,
  deleteJob
};
