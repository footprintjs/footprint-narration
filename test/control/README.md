# The controls — the code this package replaced, kept as it was

These files are the **control** of the differential tests: the package must say, write and keep what the
code it replaced said, wrote and kept. They are copies, never edited, never imported by `src/`.

| file | copied from | changes |
|---|---|---|
| `storydeck-0.2.0-narration.js` | storydeck `narration.js` at `2582b23` (npm `storydeck` 0.2.0) | none (byte-identical) |
| `storyreel-0.9.0-clock-slots.mjs` | footprint-storyreel `src/clock.mjs` at `eab4858` (npm 0.9.0), lines 1–188 | `export` added to the seven private functions (`checkSay`, `findSlot`, `slotPieces`, `slotMap`, `spokenOffset`, `letterStart`, `letterEnd`) |
| `storyreel-0.9.0-captions.mjs` | footprint-storyreel `src/captions.mjs` at `eab4858` | none |
| `storyreel-0.9.0-youtube.mjs` | footprint-storyreel `src/targets/youtube.mjs` at `eab4858` | none |
| `storyreel-0.9.0-readCaptions.mjs` | footprint-storyreel `src/finished.mjs` at `eab4858`, lines 268–277 (`readCaptions`) | none |

Where the package differs from a control on purpose, the test that compares them names the difference and
leaves it out of its generator — see the CHANGELOG's "Differences from the code it replaced". Keep these
files for as long as the property tests that read them exist.
