# MCHOSE Configurator

A small web app for configuring an **MCHOSE A7 V2** mouse and connecting to an **MCHOSE Ace 68** keyboard, so you
don't need MCHOSE's M HUB website. It talks to the devices over WebHID from your own browser. Nothing is uploaded and
there's no account or cloud service.

> Unofficial. Not affiliated with or endorsed by MCHOSE.

## What it can do

### A7 V2 mouse (Pro, Pro+, Ultra, Ultra+): full settings

Works over the 2.4 GHz receiver, the 8K receiver and the USB cable. Every change is written to the mouse's onboard
memory and read back to confirm it.

- Model, connection, battery and firmware
- The 3 onboard profiles
- Polling rate, 125 Hz to 8 kHz (Bluetooth tops out at 1 kHz)
- 6 DPI stages, how many are in the cycle, and the active stage
- Lift-off distance (0.7 / 1 / 2 mm on Ultra models, 1 / 2 mm on Pro models)
- Motion Sync, ripple control, angle snapping and angle tuning (−30° to +30°)
- Performance mode: Performance, eSports or Ultra
- Debounce (0-20 ms) and auto-sleep
- Button remapping: mouse buttons, keyboard keys with Ctrl/Shift/Alt/Win, media keys, DPI, profile switching, or
  disabled. Buttons that already hold a macro keep it.

### Ace keyboards: connection and protocol capture

The app recognises the Ace 68 (V2, Turbo, GT) and Ace 60 (Pro, 60X), and shows all of the keyboard's HID interfaces. It logs
every report the keyboard sends, and you can send reports by hand.

**Ace 60 (`41e4:2101`): reads settings.** Click *Read settings from keyboard* to see the firmware, active profile, the
key map for all four layers, and the raw magnetic switch values. The protocol is documented in
[`docs/ace60-protocol.md`](docs/ace60-protocol.md).

**It can't change keyboard settings yet** (actuation, rapid trigger, lighting, key remapping). The Ace keyboards use a
different protocol from the mouse, and nobody has published it. Rather than send made-up commands to your keyboard,
the app includes a recorder for the official site:

1. Click **Copy capture script** at the bottom of the app.
2. Open the M HUB web driver, press F12, and paste the script into the Console. If Chrome asks, type
   `allow pasting` first.
3. Change one setting at a time in M HUB. Before each change, run `mchoseCapture.mark('…')` to label it.
4. Run `mchoseCapture.download()`.

The recorder passes every call through unchanged; it only watches. One recording like this is enough to add the
keyboard settings to this app.

## Running it

Use **Chrome, Edge, Opera or another Chromium browser**. Firefox and Safari don't support WebHID.

**Easiest:** double-click `index.html`. Then click **Connect A7 V2** or **Connect Ace 68** and pick the device.

Or serve it locally:

```sh
npm start              # serves on http://localhost:8080
# or: python3 -m http.server 8080
```

**Hosting it:** `.github/workflows/pages.yml` runs the tests and publishes the site to GitHub Pages on every push to
`main`. To turn it on, go to the repository's Settings → Pages and set Source to "GitHub Actions".

**Linux:** Chrome needs permission to open the devices. Run this once, then unplug and replug the receiver or cable:

```sh
sudo cp udev/70-mchose.rules /etc/udev/rules.d/
sudo udevadm control --reload && sudo udevadm trigger
```

**Close M HUB first.** Two apps talking to the mouse at the same time will steal each other's replies.

## Development

The source is plain ES modules in `src/`. The page loads `app.bundle.js`, one classic script built from them, because
Chrome won't load module scripts on a page opened from disk. After editing anything in `src/`, rebuild it:

```sh
npm run build
```

```
index.html, styles.css    the page
app.bundle.js             built from src/ by `npm run build` (committed)
src/app.js                UI
src/a7v2/protocol.js      A7 V2 frame and config encoding/decoding (pure, unit tested)
src/a7v2/driver.js        A7 V2 request sequencing, retries and read-back checks
src/ace68/device.js       Ace keyboard detection and raw HID session
src/ace60/                Ace 60 protocol (pure) and read-only driver
captures/                 recordings of the official web driver, used as test fixtures
src/hid.js                WebHID helpers (serial queue, report helpers)
src/capture.js            the capture script for the official web driver (copied from the page)
tests/                    node:test suites, including a simulated A7 V2
```

```sh
npm test
```

### A7 V2 protocol in brief

The configuration interface is the vendor collection (usage page `0xFF01`). It uses feature report `0x11`
(command + 19 bytes) and `0x12` (command + 63 bytes), and every byte after the report id is XORed with `0xFF`. Settings
live in one 63-byte block: read it with `0x12 0x67`, write it back with `0x12 0x57`. Lift-off and the sensor
switches use `0x11 0x42`, sleep uses `0x11 0x0A`, buttons use `0x12 0x52`, and profiles use `0x11 0x58`. All replies
share one buffer, so the driver checks each reply's command echo, waits until the same bytes come back twice, and
spaces requests at least 25 ms apart. The source comments have the details.

## Credits

The A7 V2 protocol details come from community reverse-engineering of MCHOSE's web driver, tested on real hardware:

- [OpenMouse-Project/mouse-protocol](https://github.com/OpenMouse-Project/mouse-protocol): `docs/mchose-protocol.md`
- [alexfrih/mchose-linux](https://github.com/alexfrih/mchose-linux): `PROTOCOL.md`
- Ace 68 USB ids from the device catalog in [brayanspagnol/OpenMHub](https://github.com/brayanspagnol/OpenMHub)

The code here is a fresh implementation. No code was copied from those projects.
