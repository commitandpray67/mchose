// Records the WebHID traffic of MCHOSE's official web driver, so the Ace 68
// protocol can be implemented from real captures instead of guesses.
//
// How to use (Chrome or Edge):
//   1. Open the official M HUB web driver, but do NOT connect the keyboard yet.
//   2. Open DevTools (F12) > Console, paste this whole file, press Enter.
//   3. Connect the keyboard in M HUB and change ONE setting at a time. Before
//      each change, type   mchoseCapture.mark('what I am about to change')
//      e.g. mchoseCapture.mark('actuation W key 1.2mm -> 0.5mm')
//   4. When done, run   mchoseCapture.download()   and attach the JSON file.
//
// It only observes: every call is passed through to the real WebHID method
// unchanged. Nothing leaves your machine except the file you download.
(() => {
  if (window.mchoseCapture) {
    console.warn('mchoseCapture is already installed');
    return;
  }
  const log = [];
  const t0 = performance.now();
  const hex = (buf) => {
    const b = buf instanceof DataView ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf.buffer || buf);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
  };
  const dev = (d) => `${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')}`;
  const push = (e) => log.push({ t: Math.round(performance.now() - t0), ...e });
  const proto = HIDDevice.prototype;

  const sendReport = proto.sendReport;
  proto.sendReport = function (reportId, data) {
    push({ dev: dev(this), dir: 'out', reportId, data: hex(data) });
    return sendReport.call(this, reportId, data);
  };
  const sendFeatureReport = proto.sendFeatureReport;
  proto.sendFeatureReport = function (reportId, data) {
    push({ dev: dev(this), dir: 'feature-out', reportId, data: hex(data) });
    return sendFeatureReport.call(this, reportId, data);
  };
  const receiveFeatureReport = proto.receiveFeatureReport;
  proto.receiveFeatureReport = async function (reportId) {
    const dv = await receiveFeatureReport.call(this, reportId);
    push({ dev: dev(this), dir: 'feature-in', reportId, data: hex(dv) });
    return dv;
  };
  const open = proto.open;
  proto.open = async function () {
    const r = await open.call(this);
    push({
      dev: dev(this),
      dir: 'open',
      name: this.productName,
      collections: this.collections.map((c) => ({
        usagePage: c.usagePage,
        usage: c.usage,
        input: c.inputReports.map((x) => x.reportId),
        output: c.outputReports.map((x) => x.reportId),
        feature: c.featureReports.map((x) => x.reportId),
      })),
    });
    this.addEventListener('inputreport', (e) => push({ dev: dev(this), dir: 'in', reportId: e.reportId, data: hex(e.data) }));
    return r;
  };

  window.mchoseCapture = {
    log,
    mark(note) {
      push({ dir: 'mark', note: String(note) });
      console.log(`marked: ${note}`);
    },
    download() {
      const blob = new Blob([JSON.stringify({ userAgent: navigator.userAgent, page: location.href, log }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mchose-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
    },
  };
  console.log('mchoseCapture installed. Now connect the device in M HUB.');
})();
