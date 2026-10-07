---
name: footprint-narration
description: Say a narration with a voice and caption it as written, with footprint-narration — the shown↔spoken map (numbers, symbols and acronyms said in words, shown as written; hand slots and automatic rules), sentence and word captions in one SRT/WebVTT writer, YouTube chapters that are fixed and reported, and a voice clip cache keyed by exactly what is said. Use when turning text into what a TTS voice should say, captioning a narrated video or deck, writing chapters for YouTube, or voicing lines through a local voice kit.
---

# footprint-narration: what a voice says, and what a caption shows

A voice drops or garbles digits and a forced aligner knows only letters, so a narration is **said in words and
shown as written**. Everything here rests on one map from the shown text to the spoken text. Two doors:

| You need | Import | Runs |
|---|---|---|
| the shown↔spoken map, sentences, captions, chapters | `footprint-narration` | anywhere (browser or Node), no dependencies |
| a voice clip cache, the voice port, the Chatterbox kit adapter | `footprint-narration/voice` | **Node only** |

Never import `footprint-narration/voice` into browser code.

## Recipes

**What should the voice say for this text?** The automatic rules say numbers in words, spell UI/API/APIs, say a
lone `& + = × %` or Greek letter, say `< >` only before a number, and drop every word without a letter (a pause:
its sentence end moves onto the word before, else that word gets a comma).

```js
import { spokenMap, autoRules, SPELL } from 'footprint-narration';
const rules = autoRules({ spell: { ...SPELL, 日本: 'Japan' } });   // build once, reuse
spokenMap('Errors fell 90 % — then 3 more.', { rules }).spoken;   // 'Errors fell ninety percent, then three more.'
```

**A place the rules get wrong** ("1,250" reads as "one,two hundred fifty", "3.5" as "three.five"): give that exact
place a slot. Slots are positions, matched in order, each where its shown text stands whole.

```js
spokenMap('It took 1,250 ms.', { slots: [['1,250 ms', 'twelve hundred fifty milliseconds']], rules });
```

**Captions that show what is written while the voice said words:** time the spoken words (an aligner, or even
timings), then `shownWords(map, words)` collapses each said run back into what is shown; chunk them on tracks.

```js
import { shownWords, captionChunks, captionFile, FILE_CHUNKS } from 'footprint-narration';
const tracks = scenes.map((s) => ({ offset: s.offset, duration: s.duration, words: shownWords(s.map, s.words) }));
const srt = captionFile(captionChunks(tracks, FILE_CHUNKS), 'srt');   // numbered, two lines at most
```

A deck whose clips know only sentence starts uses `captionCues(steps)` instead; both go through `captionFile`.

**YouTube chapters:** `youtubeChapters(marks, { length })` → `{ lines, text, kept, changes, problems }`. Paste
`text`; print `changes` (moved / replaced / merged / dropped) so the author sees what YouTube's rules changed.

**Voice lines through a local kit (Node):**

```js
import { chatterboxKit, voiceClips, clipFor, pickSteps } from 'footprint-narration/voice';
const engine = chatterboxKit({ kit: '../voice-kit' });
await voiceClips(spokenTexts, { cache: 'voice-cache', profile, engine, only: pickSteps(process.env.ONLY) });
const clip = clipFor(spokenTexts[0], { cache: 'voice-cache', profile });   // { key, audio, duration, sentences, words }
```

Voice the **spoken** text (`map.spoken`), never the shown text: the key is a hash of what is said.

## Laws — do not break these

- `clipKey` is byte-stable: sha1/12 of `JSON.stringify({ id, exaggeration, cfgWeight, seed, gap, takes, text })` in
  that order. Never re-spell it (sorted keys, another hash): every existing clip would be lost.
- The pieces of a map join back to both texts exactly; a custom `rules` strategy (`{ name, apply(pieces) }`) may
  rewrite only `kind: 'text'` pieces and must never change what is shown (`spokenMap` refuses one that does).
- What a slot or a rule says is final: no later rule reads it again.
- A spell/say value is words — a letter in every word, no digits, no comma, semicolon or colon at its end
  (`autoRules` refuses `'Windows 11'`: write `'Windows eleven'`).
- Clone only your own voice; a profile carries its consent and its watermark.

## Pitfalls

- `spokenMap` refuses a slot list `checkSlots` refuses; check a storyboard's slots up front with
  `checkSlots(text, slots, { name: 'scene 3', field: 'say' })` to name the place in its message.
- `captionChunks` takes tracks, each word's times from its track's start; `offset` puts the track on the video's clock.
- `captionFile(…, 'vtt')` escapes `& < >`; read files back with `readCaptions`, which reads the escapes.
- `unsaidDigits(map)` lists digits a voice would still read: refuse them before voicing.
