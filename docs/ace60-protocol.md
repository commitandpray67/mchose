# MCHOSE Ace 60 protocol (41e4:2101)

Worked out from [`captures/ace60-mhub-read.json`](../captures/ace60-mhub-read.json), a recording of MCHOSE's M HUB
web driver connecting to a real Ace 60 (it reports itself as `Ace 60`, USB `41e4:2101`, a Sinowealth controller).
All 183 recorded keyboard frames match the frame and checksum below.

The recording covers **reading** only. The commands that change settings haven't been captured yet.

## Interface

One HID collection: usage page `0x0001` (Generic Desktop), usage `0x0000`, unnumbered report `0`, 64 bytes in and
out. Requests go out with `sendReport(0, frame)`, and replies come back as input reports.

## Frame

| Byte | Request | Reply |
| --- | --- | --- |
| 0 | `0x55` | `0xaa` |
| 1 | command | command (echo) |
| 2 | `0` | `0` |
| 3 | checksum: sum of bytes 4..63, low 8 bits | same |
| 4 | length to read (at most 56) | length returned |
| 5..6 | offset into the block, little-endian | echo |
| 7 | `0` | `0` |
| 8..63 | zero for reads | data |

A reply's offset echoes the request's. Its length can be shorter than the length asked for (the info reply is 22
bytes).

## Read commands

| Cmd | Block | What it holds |
| --- | --- | --- |
| `0x03` | one frame | u16 `0x0120` (firmware version?), then the build date as ASCII: `Jan 10 2026,14:58:22` |
| `0x04` | one frame | active profile (0-based), profile count (3), then the profile ids |
| `0x05` | 64 bytes | general settings, not decoded yet: `00 00 aa bb 04 00 00 06 05 28 00 00 01 00 ff 00`, 16 zero bytes, then 32 × `10` |
| `0x08` | 4 layers at `0x000`, `0x200`, `0x400`, `0x600` | key map, 128 slots × 3 bytes per layer |
| `0xa0` | 1024 bytes | magnetic switch settings, 128 slots × 8 bytes |
| `0x0c` | 4096 bytes | all zero here; probably macros |
| `0xf1` | | storage M HUB keeps for itself: JSON such as `["i18n<defaultOnboard>", ...]` (profile names) and `<light@v2>…` (lighting UI state) |
| `0xa9` | | sent unprompted by the keyboard (`01 01`) |

M HUB reads each block in 56-byte chunks from the start (64 → 56 + 8). Each key map layer is read separately as
384 bytes (56 × 6 + 48).

`0xf2` writes M HUB's own storage. The recording has M HUB rewriting a `[0, <timestamp>, "<id>"]` entry at offset
`0x268`. That's app bookkeeping, not a keyboard setting.

## Key map entries

Each entry is `[type, arg, code]`:

| Type | Meaning | Example |
| --- | --- | --- |
| `0x00` | unused slot | `00 00 00` |
| `0x10` | keyboard: `arg` = modifier mask (Ctrl, Shift, Alt, Win, then the right-hand ones), `code` = HID usage | `10 00 29` Esc, `10 02 00` Shift |
| `0x30` | consumer/media: `arg` = usage | `30 cd 00` play/pause |
| `0xf0` | keyboard function: `arg` selects it | `f0 ff 01` Fn (to layer 1), `f0 ff 03` Fn on the Mac layer |

Slots past the matrix read `f0 f0 f0` or `ff ff ff`. Layer 0 is Windows, layer 1 is Windows Fn, layer 2 is Mac (Alt
and Win swapped), and layer 3 is Mac Fn. 61 slots are used, which matches the Ace 60's 61 keys.

## Magnetic switch entries

8 bytes per slot, read here as four little-endian u16 values. On factory settings, every key read
`416 / 74 / 14 / 14` (`a0 01 4a 00 0e 00 0e 00`). Which value is the actuation point and which are the
rapid-trigger press and release sensitivities, and in what units, needs a recording that changes each one.

## Next recording needed

To add settings changes, record M HUB making one change at a time, each with a `mark`:

- actuation point, all keys, from one extreme to the other
- rapid trigger on/off, then press and release sensitivity
- one key remapped, e.g. Caps Lock → Ctrl
- one lighting change (effect, brightness, colour)
- polling rate, if M HUB offers it
