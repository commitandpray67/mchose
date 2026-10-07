// Thin WebHID helpers shared by the drivers.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function hidAvailable() {
  return typeof navigator !== 'undefined' && 'hid' in navigator;
}

// Runs async jobs one at a time with a minimum gap between them. The A7 V2
// chokes when transactions arrive faster than ~25 ms apart, and its single
// reply buffer means two overlapping reads would steal each other's answers.
export class SerialQueue {
  constructor(gapMs = 25) {
    this.gapMs = gapMs;
    this.tail = Promise.resolve();
    this.last = 0;
  }

  run(job) {
    const next = this.tail.then(async () => {
      const wait = this.last + this.gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await job();
      } finally {
        this.last = Date.now();
      }
    });
    this.tail = next.catch(() => {});
    return next;
  }
}

export function dataViewBytes(dv) {
  return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength).slice();
}

export function collectionsSummary(device) {
  const ids = (list) => (list || []).map((r) => `0x${r.reportId.toString(16).padStart(2, '0')}`);
  const walk = (cols, depth = 0) =>
    cols.flatMap((c) => [
      {
        depth,
        usagePage: c.usagePage,
        usage: c.usage,
        input: ids(c.inputReports),
        output: ids(c.outputReports),
        feature: ids(c.featureReports),
      },
      ...walk(c.children || [], depth + 1),
    ]);
  return walk(device.collections || []);
}

export function hasFeatureReports(device, usagePage, ids) {
  const match = (c) =>
    (c.usagePage === usagePage && ids.every((id) => (c.featureReports || []).some((r) => r.reportId === id))) ||
    (c.children || []).some(match);
  return (device.collections || []).some(match);
}
