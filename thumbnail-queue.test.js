"use strict";

const assert = require("node:assert/strict");
const ThumbnailQueue = require("./thumbnail-queue.js");

async function run() {
  await preservesFifoOrder();
  await prioritizesActivePage();
}

async function preservesFifoOrder() {
  const queue = new ThumbnailQueue(1);
  let active = 0;
  let peak = 0;
  const completed = [];

  await Promise.all([0, 1, 2, 3].map(index => queue.enqueue(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    completed.push(index);
    active -= 1;
  })));

  assert.equal(peak, 1, "очередь не должна запускать несколько декодирований одновременно");
  assert.deepEqual(completed, [0, 1, 2, 3], "задачи должны выполняться в порядке постановки");
}

async function prioritizesActivePage() {
  const queue = new ThumbnailQueue(1);
  const completed = [];
  let releaseRunning;
  const running = queue.enqueue(() => new Promise(resolve => {
    releaseRunning = () => { completed.push("running"); resolve(); };
  }), 1);

  const oldPage = queue.enqueue(() => { completed.push("old-page"); }, 1);
  const activeFirst = queue.enqueue(() => { completed.push("active-1"); }, 2);
  const activeSecond = queue.enqueue(() => { completed.push("active-2"); }, 2);
  await Promise.resolve();
  releaseRunning();

  await Promise.all([running, oldPage, activeFirst, activeSecond]);
  assert.deepEqual(
    completed,
    ["running", "active-1", "active-2", "old-page"],
    "активная страница должна обгонять фоновые задачи"
  );
}

run().then(() => console.log("thumbnail queue: ok"));
