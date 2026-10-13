# voice/ — a narration in a voice, cached by what it says (Node only)

**Why:** voicing is slow and a voice kit runs locally on a GPU. A clip is kept under the hash of its recipe — the
profile's settings and the exact spoken text — so editing one line re-voices that line and nothing else, a line
said twice is voiced once, and an interrupted run keeps every batch it finished.

```js
import { chatterboxKit, voiceClips, clipFor } from 'footprint-narration/voice';

const engine = chatterboxKit({ kit: '../voice-kit' });               // an adapter of the voice port
await voiceClips(texts, { cache: 'voice-cache', profile, engine });  // only the texts with no clip yet
clipFor(texts[0], { cache: 'voice-cache', profile });               // { key, audio, duration, sentences, words, take }
```

- `key.js` — `clipKey`: sha1 (12 hex) of `JSON.stringify({ id, exaggeration, cfgWeight, seed, gap, takes, text })`,
  in that order. **Byte-stable forever**: every clip a deck already has is found by this exact spelling.
- `cache.js` — `clipFor`, `voiceClips` (batches; a clip's `.json` keeps `{ text, duration, sentences }`, `words`
  when the engine aligned some, `take` when it was cut from a recorded take — `clipFor` gives `null` for either
  otherwise), `pickSteps` ("1-3,7"). An engine may carry a `profile` (it fills that profile's clips only) and a
  `preflight(scenes)` (handed every scene to voice before the first batch, to refuse them all at once).
- `chatterbox.js` — `chatterboxKit`: writes a storyboard, runs the kit's Python offline (`HF_HUB_OFFLINE=1`),
  reads `timings.json`. The port is `{ name, synthesize(scenes, { work }) }`: bring another adapter with that shape.
- `spawn.js` — how a tool the voice door runs failed (`failure`, `lastLine`): the one reading of `spawnSync`.

## Your own recorded takes

**Why:** the owner can read his script himself, and each recording must line up with its text exactly as a cloned
line does. `recordedTakes` is the second adapter of the same port, so the cache, the captions and every page that
plays a clip stay as they are.

```js
import { recordedTakes, voiceClips } from 'footprint-narration/voice';

const takes = recordedTakes({ kit: '../voice-kit', takes: 'takes', log: console.log });
await voiceClips(texts, { cache: 'voice-cache', profile: takes.profile, engine: takes });
// take 004.m4a: 6.10 s → 4.35 s (cut 0.82 s before, 0.31 s after; pauses capped to 0.60 s: 1.62 s at 2.40 s)
//   · 14 words aligned, mean score 0.86, letters 0.97 · LOW, listen: "latency" 0.21
```

`takes/takes.json` maps each line, as it is said, to its recording: `{ "<the line>": "004.m4a" }`. A manifest
rather than files named by their clip key: the file names stay the recorder's, the folder reads as the script, and a
line is matched by its words (`normSpeech`), so a curly quote or a dropped comma still finds its take, while an edited
line is listed for recording again.

Each take goes through four steps, and each records its verdict. Every refusal lists every take it applies to, at
once, and names the fix.

| step | file | does | refuses |
|---|---|---|---|
| find | `takes.js` | `readTakeBook`, `findTakes`: the take of each line | no takes.json, a file it names that is missing, two takes for the same words; every line with no take, ready to paste |
| trim | `trim.js`, `wav.js` | ffmpeg decodes the take to 16-bit mono PCM; the level is measured per 10 ms; the cut is planned in whole samples (`planTrim`); ffmpeg cuts it (`atrim` + `concat`, bit-exact) | a take with no sound above `threshold` |
| align | `align.js`, `align_take.py` | the kit's MMS_FA aligner (`tts_chatterbox.py · align`) runs in the kit's Python, offline, and writes `timings.json` in the kit's shape | a word with no letters (say it in words); a missing or failing Python |
| check | `align.js` | `check_words.py`'s report: a score per word (low under 0.3) and the letters heard against the text's | a take the aligner could not fit to its words |

The trim settings (`trim.js · TRIM`) are `threshold` -45 dB, `lead` 0.2 s and `tail` 0.4 s (the kit's own),
`maxPause` 0.6 s and `minSound` 0.1 s. A shorter sound before the first word or after the last (a click, a key) is
silence. A short sound between two pauses is never cut, because it may be a word.

**The key.** `clipKey` is untouched. The session's `profile` (`takes.js · sessionProfile`) is
`{ id: 'take-<12 hex>', engine: 'recorded' }`. Its id is a hash of every take's words and bytes and of the trim
settings, and the id is already part of the key's recipe. So a recorded line and a cloned line of the same text
never share a key, and a line recorded again, a new line or a new setting starts a new session. Every line is then
cut and aligned again, which takes seconds and generates no voice, so no stale clip is ever served. `voiceClips`
refuses the recorded engine with any other profile, and a recorded profile with any other engine.

Low words are a report, not a gate, as in `check_words.py`. A take of the wrong line can still align with every word
low and its letters near 0, so read the log or the clip's `take.check`. Only the owner of a voice may record or clone
it.
