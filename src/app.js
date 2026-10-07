import * as P from './a7v2/protocol.js';
import { A7V2, HID_FILTERS as MOUSE_FILTERS, isA7V2 } from './a7v2/driver.js';
import * as Ace from './ace68/device.js';
import { KEYS, keyLabel } from './keys.js';
import { collectionsSummary, hidAvailable } from './hid.js';
import { captureSnippet } from './capture.js';
import * as K from './ace60/protocol.js';
import { Ace60, isAce60Config } from './ace60/driver.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
};

/* ---------- toast, busy state, log ---------- */

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), kind === 'err' ? 6000 : 2500);
}

async function busy(label, job) {
  document.body.classList.add('busy');
  document.querySelectorAll('#mouse button, #mouse input, #mouse select').forEach((n) => (n.disabled = true));
  try {
    const r = await job();
    if (label) toast(label, 'ok');
    return r;
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), 'err');
    return null;
  } finally {
    document.body.classList.remove('busy');
    document.querySelectorAll('#mouse button, #mouse input, #mouse select').forEach((n) => (n.disabled = false));
    if (mouse?.config) renderMouse();
  }
}

const logLines = [];
function logEntry(dir, reportId, bytes) {
  if (!$('#log-enabled').checked) return;
  const entry = { t: new Date().toISOString(), dir, reportId, data: P.hexBytes(bytes) };
  logLines.push(entry);
  if (logLines.length > 2000) logLines.shift();
  const pre = $('#log');
  pre.textContent += `${entry.t.slice(11, 23)}  ${dir.padEnd(11)} 0x${P.hex(reportId)}  ${entry.data}\n`;
  pre.scrollTop = pre.scrollHeight;
}

$('#log-clear').onclick = () => {
  logLines.length = 0;
  $('#log').textContent = '';
};
$('#log-save').onclick = () => {
  const blob = new Blob([JSON.stringify(logLines, null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'mchose-hid-log.json' });
  a.click();
};

/* ---------- connecting ---------- */

let mouse = null;
let keyboard = null;
let ace60 = null;

if (!hidAvailable()) {
  $('#no-hid').hidden = false;
  $('#connect-mouse').disabled = true;
  $('#connect-keyboard').disabled = true;
  $('#connect-any').disabled = true;
}

async function connectMouse(device) {
  if (!isA7V2(device)) {
    toast('That device does not speak the A7 V2 protocol (an A7 V3, or not the configuration interface).', 'err');
    return;
  }
  mouse = new A7V2(device, { log: logEntry });
  await busy(null, async () => {
    await mouse.open();
    await mouse.load();
    await loadProfileNames();
    $('#mouse').hidden = false;
    toast(mouse.recovered ? `Connected to ${mouse.info.name} (switched to profile 1 to wake its settings channel)` : `Connected to ${mouse.info.name}`, 'ok');
  });
  if (!mouse.config) $('#mouse').hidden = true;
}

$('#connect-mouse').onclick = async () => {
  const devices = await navigator.hid.requestDevice({ filters: MOUSE_FILTERS }).catch(() => []);
  const device = devices.find(isA7V2) || devices[0];
  if (device) await connectMouse(device);
};

$('#mouse-refresh').onclick = () => busy('Reloaded', () => mouse.load());
$('#mouse-disconnect').onclick = async () => {
  await mouse?.close();
  mouse = null;
  $('#mouse').hidden = true;
};

async function connectKeyboard(devices) {
  await keyboard?.close().catch(() => {});
  keyboard = new Ace.RawSession(devices, { onReport: ({ dir, reportId, bytes }) => logEntry(dir, reportId, bytes) });
  try {
    await keyboard.open();
  } catch (e) {
    toast(`Could not open the keyboard: ${e.message}`, 'err');
    return;
  }
  renderKeyboard(keyboard.devices);
  const cfg = keyboard.devices.find(isAce60Config);
  ace60 = cfg ? new Ace60(cfg, { log: logEntry }) : null;
  $('#ace60').hidden = !ace60;
  $('#keyboard').hidden = false;
}

// Every interface of the same physical keyboard that this page may use.
async function siblings(devices) {
  const [first] = devices;
  const granted = await navigator.hid.getDevices();
  const same = granted.filter((d) => d.vendorId === first.vendorId && d.productId === first.productId);
  return [...new Set([...devices, ...same])];
}

async function pickKeyboard(filters) {
  const picked = await navigator.hid.requestDevice({ filters }).catch(() => []);
  if (!picked.length) return;
  const all = await siblings(picked);
  // The vendor-defined interface, which carries configuration, goes first.
  all.sort((a, b) => Number(Ace.isVendorCollection(b)) - Number(Ace.isVendorCollection(a)));
  await connectKeyboard(all);
}

$('#connect-keyboard').onclick = () => pickKeyboard(Ace.HID_FILTERS);
// For a keyboard whose USB ids are not MCHOSE's: lists every HID device
// Chrome allows (it hides the plain typing interface of every keyboard).
$('#connect-any').onclick = () => pickKeyboard([]);

$('#keyboard-disconnect').onclick = async () => {
  await keyboard?.close();
  keyboard = null;
  ace60 = null;
  $('#keyboard').hidden = true;
};

navigator.hid?.addEventListener('disconnect', (e) => {
  if (mouse && e.device === mouse.device) {
    mouse = null;
    $('#mouse').hidden = true;
    toast('Mouse disconnected');
  }
  if (keyboard && keyboard.owns(e.device)) {
    keyboard = null;
    ace60 = null;
    $('#keyboard').hidden = true;
    toast('Keyboard disconnected');
  }
});

/* ---------- mouse UI ---------- */

let profileNames = [];
async function loadProfileNames() {
  profileNames = [];
  for (let i = 0; i < P.PROFILE_COUNT; i++) {
    const name = await mouse.readProfileName(i);
    // The factory names are Chinese ("default profile N"); show those as
    // "Profile N" and keep names the user set.
    profileNames.push(!name || /[\u3000-\u9fff]/.test(name) ? `Profile ${i + 1}` : name);
  }
}

function segmented(container, items, current, onPick) {
  container.replaceChildren(
    ...items.map((it) =>
      el('button', {
        textContent: it.label,
        disabled: it.disabled,
        ariaPressed: String(it.value === current),
        onclick: () => it.value !== current && onPick(it.value),
      }),
    ),
  );
}

function renderMouse() {
  const { info, config: c } = mouse;
  const link = c[mouse.linkKey()];
  $('#mouse-title').textContent = `MCHOSE ${info.name}`;

  const facts = [
    ['Model', info.name],
    ['Connection', info.linkLabel],
    ['Battery', info.status.online || info.link === 'wired' ? `${info.status.battery}%${info.status.charging ? ' (charging)' : ''}` : 'asleep'],
    ['Firmware', info.firmware || '—'],
    ['USB id', `${P.hex(mouse.device.vendorId, 4)}:${P.hex(mouse.device.productId, 4)}`],
  ];
  $('#mouse-info').replaceChildren(...facts.map(([k, v]) => el('div', {}, el('dt', { textContent: k }), el('dd', { textContent: v }))));

  segmented(
    $('#profiles'),
    profileNames.map((name, i) => ({ label: name, value: i })),
    c.profile,
    (i) => busy(`Switched to ${profileNames[i]}`, () => mouse.setProfile(i)),
  );

  segmented(
    $('#rates'),
    P.POLLING_RATES.map((hz, i) => ({ label: hz >= 1000 ? `${hz / 1000}K Hz` : `${hz} Hz`, value: i, disabled: i > info.maxRateIndex })),
    link.rate,
    (i) => busy(`Polling rate set to ${P.POLLING_RATES[i]} Hz`, () => mouse.setPollingRate(i)),
  );
  $('#rate-hint').textContent =
    info.link === 'bluetooth'
      ? 'Bluetooth is limited to 1000 Hz.'
      : `Applies to the ${info.link === 'wired' ? 'cable' : 'receiver'} connection. 4K and 8K Hz need the 8K receiver or the cable.`;

  // DPI stages
  const stages = $('#dpi-stages');
  stages.replaceChildren(
    ...c.dpi.map((v, i) => {
      const off = i >= c.stageCount;
      return el(
        'div',
        { className: `stage${off ? ' off' : ''}` },
        el(
          'div',
          { className: 'top' },
          el('span', { textContent: `Stage ${i + 1}` }),
          el('button', {
            className: 'dot',
            title: 'Make active',
            ariaLabel: `Make stage ${i + 1} active`,
            ariaPressed: String(i === link.stage),
            disabled: off,
            onclick: () => i !== link.stage && busy(`Stage ${i + 1} active`, () => mouse.setActiveStage(i)),
          }),
        ),
        el('input', { type: 'number', min: P.DPI_MIN, max: info.dpiMax, step: 50, value: v }),
      );
    }),
  );
  $('#stage-count').replaceChildren(
    ...Array.from({ length: P.DPI_STAGES }, (_, i) => el('option', { value: i + 1, textContent: i + 1, selected: i + 1 === c.stageCount })),
  );

  // Sensor
  $('#lod').replaceChildren(...info.lod.map((mm, i) => el('option', { value: i, textContent: `${mm} mm`, selected: i === c.lod })));
  $('#motion-sync').checked = c.motionSync;
  $('#ripple').checked = c.ripple;
  $('#angle-snap').checked = c.angleSnap;
  $('#angle').value = c.angle;
  $('#angle-out').textContent = `${c.angle > 0 ? '+' : ''}${c.angle}°`;

  segmented($('#perf'), P.PERF_MODES, c.perfMode, (m) =>
    busy(`${P.PERF_MODES.find((x) => x.value === m).label} mode`, () => mouse.setPerformance({ perfMode: m })),
  );

  $('#debounce').value = c.debounce;
  $('#sleep').value = c.sleep;

  renderButtons();
}

$('#dpi-save').onclick = () => {
  const max = mouse.info.dpiMax;
  const values = [...document.querySelectorAll('#dpi-stages input')].map((n) => Number(n.value));
  const bad = values.find((v) => !Number.isFinite(v) || v < P.DPI_MIN || v > max);
  if (bad !== undefined) return toast(`DPI must be between ${P.DPI_MIN} and ${max}`, 'err');
  const count = Number($('#stage-count').value);
  busy('DPI saved', async () => {
    await mouse.setDpi(values, count);
    const key = mouse.linkKey();
    if (mouse.config[key].stage >= count) await mouse.setActiveStage(0);
  });
};

$('#lod').onchange = (e) => busy('Lift-off distance saved', () => mouse.setPerformance({ lod: Number(e.target.value) }));
$('#motion-sync').onchange = (e) => busy('Saved', () => mouse.setPerformance({ motionSync: e.target.checked }));
$('#ripple').onchange = (e) => busy('Saved', () => mouse.setPerformance({ ripple: e.target.checked }));
$('#angle-snap').onchange = (e) => busy('Saved', () => mouse.setPerformance({ angleSnap: e.target.checked }));
$('#angle').oninput = (e) => ($('#angle-out').textContent = `${e.target.value > 0 ? '+' : ''}${e.target.value}°`);
$('#angle').onchange = (e) => busy('Angle saved', () => mouse.setPerformance({ angle: Number(e.target.value) }));

$('#timing-save').onclick = () => {
  const debounce = Number($('#debounce').value);
  const minutes = Number($('#sleep').value);
  if (!Number.isInteger(debounce) || debounce < 0 || debounce > P.DEBOUNCE_MAX) return toast('Debounce must be 0-20 ms', 'err');
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 255) return toast('Sleep must be 0-255 minutes', 'err');
  busy('Timing saved', async () => {
    if (debounce !== mouse.config.debounce) await mouse.setDebounce(debounce);
    if (minutes !== mouse.config.sleep) await mouse.setSleep(minutes);
  });
};

/* ---------- button remapping ---------- */

const TYPE_OPTIONS = [
  { type: P.BTN.default, label: 'Factory default' },
  { type: P.BTN.mouse, label: 'Mouse', actions: P.MOUSE_ACTIONS },
  { type: P.BTN.keyboard, label: 'Keyboard key' },
  { type: P.BTN.media, label: 'Media', actions: P.MEDIA_ACTIONS },
  { type: P.BTN.dpi, label: 'DPI', actions: P.DPI_ACTIONS },
  { type: P.BTN.profile, label: 'Profile', actions: P.PROFILE_ACTIONS },
  { type: P.BTN.disabled, label: 'Disabled' },
];

function describe(btn) {
  if (btn.type === P.BTN.keyboard) {
    const mods = Object.entries(P.MODIFIERS)
      .filter(([, m]) => (btn.value >> 16) & m)
      .map(([k]) => k[0].toUpperCase() + k.slice(1));
    return [...mods, keyLabel((btn.value >> 8) & 0xff)].join(' + ');
  }
  return P.describeButton(btn);
}

function renderButtons() {
  const body = $('#buttons tbody');
  body.replaceChildren(
    ...P.BUTTONS.map((name, i) => {
      const cur = mouse.config.buttons[i];
      const typeSel = el('select', { ariaLabel: `${name} action type` },
        ...TYPE_OPTIONS.map((o) => el('option', { value: o.type, textContent: o.label, selected: o.type === cur.type })));
      const valueCell = el('td');
      const apply = el('button', { textContent: 'Apply' });

      const fillValue = () => {
        const opt = TYPE_OPTIONS.find((o) => o.type === Number(typeSel.value));
        valueCell.replaceChildren();
        if (opt?.actions) {
          valueCell.append(el('select', { className: 'value', ariaLabel: `${name} action` },
            ...opt.actions.map((a) => el('option', { value: a.value, textContent: a.label, selected: opt.type === cur.type && a.value === cur.value }))));
        } else if (opt?.type === P.BTN.keyboard) {
          const usage = cur.type === P.BTN.keyboard ? (cur.value >> 8) & 0xff : 0x3a;
          const mods = cur.type === P.BTN.keyboard ? cur.value >> 16 : 0;
          valueCell.append(
            el('select', { className: 'key', ariaLabel: `${name} key` },
              ...KEYS.map((k) => el('option', { value: k.usage, textContent: k.label, selected: k.usage === usage }))),
            el('div', { className: 'seg' },
              ...Object.entries(P.MODIFIERS).map(([k, m]) =>
                el('label', { className: 'check' },
                  el('input', { type: 'checkbox', className: 'mod', value: m, checked: Boolean(mods & m) }),
                  k[0].toUpperCase() + k.slice(1)))),
          );
        }
      };
      typeSel.onchange = fillValue;
      fillValue();

      apply.onclick = () => {
        const type = Number(typeSel.value);
        let value = 0;
        if (type === P.BTN.keyboard) {
          const usage = Number(valueCell.querySelector('.key').value);
          const mods = [...valueCell.querySelectorAll('.mod:checked')].reduce((m, n) => m | Number(n.value), 0);
          value = P.keyValue(usage, mods);
        } else if (valueCell.querySelector('.value')) {
          value = Number(valueCell.querySelector('.value').value);
        }
        if (i === 0 && !(type === P.BTN.default || (type === P.BTN.mouse && value === 0x010000))) {
          const keepsLeft = mouse.config.buttons.some((b, j) => j !== 0 && b.type === P.BTN.mouse && b.value === 0x010000);
          if (!keepsLeft && !confirm('This removes left click from the left button and no other button is set to left click. Continue?')) return;
        }
        busy(`${name} button saved`, () => mouse.setButton(i, type, value));
      };

      const current = cur.type === P.BTN.macro ? `Macro (kept as is)` : describe(cur);
      return el('tr', {},
        el('td', { textContent: name }),
        el('td', {}, typeSel, el('div', { className: 'current', textContent: `Now: ${current}` })),
        valueCell,
        el('td', {}, apply));
    }),
  );
}

/* ---------- keyboard UI ---------- */

function renderKeyboard(devices) {
  const device = devices[0];
  const model = Ace.modelFor(device);
  $('#keyboard-title').textContent = `MCHOSE ${model?.name ?? device.productName}`;
  const facts = [
    ['Model', model?.name ?? 'not in the list'],
    ['Product name', device.productName || '—'],
    ['USB id', `${P.hex(device.vendorId, 4)}:${P.hex(device.productId, 4)}`],
    ['Interfaces', `${devices.length}${devices.some(Ace.isVendorCollection) ? ', incl. vendor (configuration)' : ', no vendor interface'}`],
  ];
  $('#keyboard-info').replaceChildren(...facts.map(([k, v]) => el('div', {}, el('dt', { textContent: k }), el('dd', { textContent: v }))));
  $('#collections tbody').replaceChildren(
    ...devices.flatMap((d) => collectionsSummary(d)).map((c) =>
      el('tr', {},
        el('td', { textContent: `${'  '.repeat(c.depth)}0x${P.hex(c.usagePage, 4)}` }),
        el('td', { textContent: `0x${P.hex(c.usage, 4)}` }),
        el('td', { textContent: c.input.join(' ') || '—' }),
        el('td', { textContent: c.output.join(' ') || '—' }),
        el('td', { textContent: c.feature.join(' ') || '—' }))),
  );
  $('#log-enabled').checked = true;
}

const rawArgs = () => [Number($('#raw-id').value) || 0, Ace.parseHex($('#raw-bytes').value)];
const rawGuard = async (job) => {
  if (!keyboard) return;
  try {
    await job();
  } catch (e) {
    toast(e.message, 'err');
  }
};
$('#raw-output').onclick = () => rawGuard(() => keyboard.sendOutput(...rawArgs()));
$('#raw-feature').onclick = () => rawGuard(() => keyboard.sendFeature(...rawArgs()));
$('#raw-read').onclick = () => rawGuard(() => keyboard.readFeature(rawArgs()[0]));

/* ---------- Ace 60 (read-only) ---------- */

$('#ace60-read').onclick = async () => {
  if (!ace60) return;
  const btn = $('#ace60-read');
  btn.disabled = true;
  try {
    const r = await ace60.load();
    renderAce60(r);
    toast('Read the keyboard settings', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
};

function renderAce60({ info, profile, settings, layers, switches }) {
  const facts = [
    ['Firmware', info.version],
    ['Built', info.build],
    ['Profile', `${profile.active + 1} of ${profile.count}`],
  ];
  $('#ace60-info').replaceChildren(...facts.map(([k, v]) => el('div', {}, el('dt', { textContent: k }), el('dd', { textContent: v }))));

  const rows = [];
  for (let slot = 0; slot < K.KEY_SLOTS; slot++) {
    const cells = layers.map((l) => K.describeEntry(l.keys[slot], keyLabel));
    if (cells.every((c) => !c)) continue;
    rows.push(el('tr', {}, el('td', { textContent: slot }), ...cells.map((c) => el('td', { textContent: c || '—' }))));
  }
  $('#ace60-keymap tbody').replaceChildren(...rows);

  const groups = new Map();
  switches.forEach((v, slot) => {
    if (layers[0].keys[slot] && K.isEmpty(layers[0].keys[slot])) return;
    const key = v.join(' / ');
    groups.set(key, [...(groups.get(key) || []), slot]);
  });
  $('#ace60-switches tbody').replaceChildren(
    ...[...groups].map(([values, slots]) => el('tr', {}, el('td', { textContent: slots.length === 1 ? `slot ${slots[0]}` : `${slots.length} keys` }), el('td', { textContent: values }))),
  );
  $('#ace60-settings').textContent = P.hexBytes(settings);
}

/* ---------- capture script ---------- */

$('#capture-text').value = captureSnippet();
$('#copy-capture').onclick = async () => {
  try {
    await navigator.clipboard.writeText(captureSnippet());
  } catch {
    const t = $('#capture-text');
    t.closest('details').open = true;
    t.select();
    document.execCommand('copy');
  }
  toast('Capture script copied. Paste it into the M HUB tab\'s Console.', 'ok');
};

/* ---------- reconnect devices granted earlier ---------- */

(async () => {
  if (!hidAvailable()) return;
  const granted = await navigator.hid.getDevices();
  const m = granted.find(isA7V2);
  if (m) await connectMouse(m);
  const k = granted.filter(Ace.isAce68);
  if (k.length) await connectKeyboard(await siblings(k));
})();
