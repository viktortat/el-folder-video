(function(root, factory) {
  var ThumbnailQueue = factory();
  if (typeof module === "object" && module.exports) module.exports = ThumbnailQueue;
  root.ThumbnailQueue = ThumbnailQueue;
})(typeof globalThis === "undefined" ? this : globalThis, function() {
  "use strict";

  function ThumbnailQueue(limit) {
    this.limit = Math.max(1, Number(limit) || 1);
    this.running = 0;
    this.pending = [];
    this.sequence = 0;
  }

  ThumbnailQueue.prototype.enqueue = function(task, priority) {
    var self = this;
    return new Promise(function(resolve, reject) {
      self.pending.push({
        task: task,
        resolve: resolve,
        reject: reject,
        priority: Number(priority) || 0,
        sequence: self.sequence++
      });
      self.pending.sort(function(left, right) {
        return right.priority - left.priority || left.sequence - right.sequence;
      });
      self.drain();
    });
  };

  ThumbnailQueue.prototype.drain = function() {
    var self = this;
    while (self.running < self.limit && self.pending.length) {
      var job = self.pending.shift();
      self.running += 1;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(function() {
          self.running -= 1;
          self.drain();
        });
    }
  };

  return ThumbnailQueue;
});
