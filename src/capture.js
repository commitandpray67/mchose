// Records the WebHID traffic of MCHOSE's official web driver (M HUB), so the
// keyboard protocol can be implemented from real captures instead of guesses.
//
// The page offers this as text to paste into the DevTools console of the M HUB
// site (see captureSnippet). It only observes: every call is passed through to
// the real WebHID method unchanged, and nothing leaves the machine except the
// file the user downloads.
//
// installCapture must stay self-contained (no references to anything outside
// its body), because it is serialised with toString().
export function installCapture() {
  if (window.mchoseCapture) {
    return 'mchoseCapture is already installed';
  }
  const log = [];
  const t0 = performance.now();
  const hex = (buf) => {
    const b = ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
  };
  const id = (d) => `${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')}`;
  const push = (e) => log.push({ t: Math.round(performance.now() - t0), ...e });
  const describe = (d) => ({
    dev: id(d),
    name: d.productName,
    collections: d.collections.map((c) => ({
      usagePage: c.usagePage,
      usage: c.usage,
      input: c.inputReports.map((x) => x.reportId),
      output: c.outputReports.map((x) => x.reportId),
      feature: c.featureReports.map((x) => x.reportId),
    })),
  });
  const watched = new WeakSet();
  const watch = (d) => {
    if (watched.has(d)) return;
    watched.add(d);
    push({ dir: 'device', ...describe(d) });
    d.addEventListener('inputreport', (e) => push({ dev: id(d), dir: 'in', reportId: e.reportId, data: hex(e.data) }));
  };

  const proto = HIDDevice.prototype;
  const wrap = (name, fn) => {
    const orig = proto[name];
    proto[name] = function (...args) {
      return fn.call(this, orig, ...args);
    };
  };
  wrap('sendReport', function (orig, reportId, data) {
    watch(this);
    push({ dev: id(this), dir: 'out', reportId, data: hex(data) });
    return orig.call(this, reportId, data);
  });
  wrap('sendFeatureReport', function (orig, reportId, data) {
    watch(this);
    push({ dev: id(this), dir: 'feature-out', reportId, data: hex(data) });
    return orig.call(this, reportId, data);
  });
  wrap('receiveFeatureReport', async function (orig, reportId) {
    const dv = await orig.call(this, reportId);
    push({ dev: id(this), dir: 'feature-in', reportId, data: hex(dv) });
    return dv;
  });
  wrap('open', async function (orig) {
    const r = await orig.call(this);
    watch(this);
    return r;
  });
  // Devices M HUB opened before the script was pasted.
  navigator.hid.getDevices().then((list) => list.filter((d) => d.opened).forEach(watch));

  window.mchoseCapture = {
    log,
    mark(note) {
      push({ dir: 'mark', note: String(note) });
      return `marked: ${note}`;
    },
    download() {
      const body = JSON.stringify({ userAgent: navigator.userAgent, page: location.href, log }, null, 1);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
      a.download = `mchose-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      return `saved ${log.length} entries`;
    },
  };
  // Returned rather than logged: the console always shows a pasted
  // expression's value, while sites may silence console.log.
  return 'mchoseCapture installed. Now use M HUB as usual; run mchoseCapture.mark("...") before each change.';
}

export const captureSnippet = () => `(${installCapture.toString()})()`;
