import assert from "node:assert/strict";
import test from "node:test";

import { installDevPerformanceEntryGuard } from "../src/utils/devPerformanceEntryGuard.js";

function harness(initialCount) {
  let count = initialCount;
  let clearedMeasures = 0;
  let clearedMarks = 0;
  let callback;
  let clearedTimer;
  return {
    performanceApi: {
      getEntriesByType: () => Array.from({ length: count }),
      clearMeasures: () => {
        count = 0;
        clearedMeasures += 1;
      },
      clearMarks: () => {
        clearedMarks += 1;
      },
    },
    timerApi: {
      setInterval: (next) => {
        callback = next;
        return 7;
      },
      clearInterval: (timer) => {
        clearedTimer = timer;
      },
    },
    setCount: (value) => {
      count = value;
    },
    tick: () => callback(),
    stats: () => ({ count, clearedMeasures, clearedMarks, clearedTimer }),
  };
}

test("clears an oversized performance measure buffer immediately", () => {
  const subject = harness(3);
  const dispose = installDevPerformanceEntryGuard({ entryLimit: 3, performanceApi: subject.performanceApi, timerApi: subject.timerApi });
  assert.deepEqual(subject.stats(), { count: 0, clearedMeasures: 1, clearedMarks: 1, clearedTimer: undefined });
  dispose();
  assert.equal(subject.stats().clearedTimer, 7);
});

test("leaves a small buffer intact and trims it after it crosses the limit", () => {
  const subject = harness(2);
  installDevPerformanceEntryGuard({ entryLimit: 3, performanceApi: subject.performanceApi, timerApi: subject.timerApi });
  assert.equal(subject.stats().clearedMeasures, 0);
  subject.setCount(3);
  assert.equal(subject.tick(), true);
  assert.equal(subject.stats().clearedMeasures, 1);
});
