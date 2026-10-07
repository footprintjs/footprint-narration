# voice/ — a narration in a voice, cached by what it says (Node only)

**Why:** voicing is slow and a voice kit runs locally on a GPU. A clip is kept under the hash of its recipe — the
profile's settings and the exact spoken text — so editing one line re-voices that line and nothing else, a line
said twice is voiced once, and an interrupted run keeps every batch it finished.

```js
import { chatterboxKit, voiceClips, clipFor } from 'footprint-narration/voice';

const engine = chatterboxKit({ kit: '../voice-kit' });               // an adapter of the voice port
await voiceClips(texts, { cache: 'voice-cache', profile, engine });  // only the texts with no clip yet
clipFor(texts[0], { cache: 'voice-cache', profile });               // { key, audio, duration, sentences, words }
```

- `key.js` — `clipKey`: sha1 (12 hex) of `JSON.stringify({ id, exaggeration, cfgWeight, seed, gap, takes, text })`,
  in that order. **Byte-stable forever**: every clip a deck already has is found by this exact spelling.
- `cache.js` — `clipFor`, `voiceClips` (batches; a clip's `.json` keeps `{ text, duration, sentences }`, and `words`
  when the engine aligned some — `clipFor` gives `words: null` otherwise), `pickSteps` ("1-3,7").
- `chatterbox.js` — `chatterboxKit`: writes a storyboard, runs the kit's Python offline (`HF_HUB_OFFLINE=1`),
  reads `timings.json`. The port is `{ name, synthesize(scenes, { work }) }`: bring another adapter with that shape.

Only the owner of a voice may clone it; a voice profile carries its consent and its watermark setting.
