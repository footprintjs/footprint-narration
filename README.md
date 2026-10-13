# footprint-narration

**What a voice says, and what a caption shows.** A voice drops or garbles digits and a forced aligner knows only
letters, so a narration is *said* in words while its captions *show* it as written: "16.67 ms" is said "sixteen
point six seven milliseconds", "UI" is said "U I", and a lone "—" is not said at all. This package owns that one
law and everything that rests on it: the shown↔spoken map, sentences and word times, caption cues and caption
files, YouTube chapters, and — for Node — a voice port with a clip cache keyed by exactly what is said.

It is the common ground of two libraries that tell stories with a voice: [StoryDeck](https://github.com/footprintjs/storydeck)
(slide decks that narrate themselves) and [footprint-storyreel](https://github.com/footprintjs/storyreel) (drawn
films). Each used to keep its own copy of these rules; the copies had started to disagree.

```sh
npm install footprint-narration
```

Two doors, nothing else:

| door | what | runs |
|---|---|---|
| `footprint-narration` | the shown↔spoken map, sentences, captions, chapters | anywhere — browser or Node; no dependencies |
| `footprint-narration/voice` | the voice port, the clip cache, its two adapters: the Chatterbox kit and your own recorded takes | **Node only** (files, child processes) |

## One text, as shown and as spoken

A **slot** says one exact place by hand; the **rules** say everything else. Use either or both.

```js
import { spokenMap, autoRules } from 'footprint-narration';

spokenMap('Keep latency < 10 ms — the UI waits.', { rules: autoRules() }).spoken;
// 'Keep latency less than ten ms, the U I waits.'

const map = spokenMap('One frame takes 16.67 ms, at 60 Hz.', {
  slots: [['16.67 ms', 'sixteen point six seven milliseconds'], ['60 Hz', 'sixty hertz']],
});
map.spoken;   // 'One frame takes sixteen point six seven milliseconds, at sixty hertz.'
map.pieces;   // [{ shown: 'One frame takes ', spoken: 'One frame takes ', kind: 'text' },
              //  { shown: '16.67 ms', spoken: 'sixteen point six seven milliseconds', kind: 'slot' }, …]
```

The automatic rules spell the few acronyms a voice misreads as a word (`SPELL`: UI, API, APIs — every other
acronym stays, since a cloned voice says LLM or MCP as quick letters), say a lone symbol that means something
(`SAY`: `& + = × %`, Greek letters, and `< >` before a number only — "File > Save As" is a menu path), say numbers
in words, and turn every other word without a letter (— → … | an emoji) into a pause: its sentence end moves onto
the word before, else that word gets a comma. Bring your own lists — `autoRules({ spell: { ...SPELL, 日本: 'Japan' } })`
— or your own strategy (`{ name, apply(pieces) }`).

**Back to what is shown.** A voice aligner times the words it *said*. `shownWords` collapses each said run back
into what the text shows, timed from its first word to its last, so captions show digits where the voice said words:

```js
import { shownWords } from 'footprint-narration';

shownWords(map, alignedWords).map((w) => w.text);   // ['One', 'frame', 'takes', '16.67 ms,', 'at', '60 Hz.']
```

`spokenOffset` maps a phrase written as shown onto the spoken words (so "at 60 Hz" finds "at sixty hertz"),
`unsaidDigits` lists the digits a voice would still have to read, and `checkSlots` refuses a slot list that cannot
be right, naming the fix.

## Captions

Two producers — by sentence (a deck's clips know each sentence's start) and by word (a film's aligner knows every
word) — one cue shape, **one writer**, one reader.

```js
import { captionCues, captionChunks, captionFile, readCaptions, FILE_CHUNKS } from 'footprint-narration';

const cues = captionCues([{ start: 10, lead: 0.5, written: 'In 2000. Done.', spoken: 'In two thousand. Done.',
  clip: { duration: 4, sentences: [0.2, 2.5] } }]);                     // shows "In 2000." while the voice says it
const chunks = captionChunks([{ offset: 3.3, duration: 4.1, words }], { maxWords: 5 });   // burned-in chunks
captionFile(captionChunks(tracks, FILE_CHUNKS), 'srt', { offset: 2 });   // a numbered SRT, two lines at most
readCaptions(vttOrSrt);                                                  // back to [{ start, end, text }]
```

The writer numbers the cues, moves them onto the video's clock (`offset`), cuts them to a partial render
(`from`, `to`), wraps a long text onto two lines near its middle, never lets `-->` into a text, and escapes
WebVTT's `& < >`; the reader reads both formats and those escapes back.

## YouTube chapters

YouTube shows chapters only when the first is at 0:00, there are at least three, and each lasts 10 s or more.
`youtubeChapters` fixes what it can and says what it did.

```js
import { youtubeChapters } from 'footprint-narration';

const list = youtubeChapters([{ at: 3, title: 'Card' }, { at: 6, title: 'Intro' }, { at: 40, title: 'One' },
  { at: 45, title: 'Aside' }, { at: 80, title: 'Two' }], { length: 205 });
list.text;      // '0:00 Intro\n0:40 One\n1:20 Two'
list.changes;   // Card replaced by Intro · Intro moved to 0:00 · Aside merged into One
```

## A voice, cached by what it says (Node)

```js
import { chatterboxKit, voiceClips, clipFor } from 'footprint-narration/voice';

const engine = chatterboxKit({ kit: '../voice-kit' });                 // a local voice kit; nothing is uploaded
await voiceClips(texts, { cache: 'voice-cache', profile, engine });    // voices only what has no clip yet
clipFor(texts[3], { cache: 'voice-cache', profile });                 // { key, audio, duration, sentences, words }
```

A clip's key is a hash of its recipe — the voice profile's settings and the exact spoken text — so editing one
line re-voices that line alone, and an interrupted run keeps every batch it finished. The engine is a port,
`{ name, synthesize(scenes, { work }) }`; `chatterboxKit` is one adapter, a test fake or a cloud voice is another.
Clone only your own voice.

## Your own voice, recorded (Node)

**Why:** a cloned voice is a stand-in. When you would rather read the script yourself, each recording should land
in the film or deck exactly as a cloned line does: the same lead and tail of silence, its words timed against the
known text by the same aligner, cached by the same key recipe. `recordedTakes` is the second adapter of the voice
port, so nothing downstream changes.

```js
import { recordedTakes, voiceClips, clipFor } from 'footprint-narration/voice';

const takes = recordedTakes({ kit: '../voice-kit', takes: 'takes' });          // your recordings + the kit's aligner
await voiceClips(texts, { cache: 'voice-cache', profile: takes.profile, engine: takes, batch: 50 });
clipFor(texts[3], { cache: 'voice-cache', profile: takes.profile }).take;
// { file: '004.m4a', trim: { length: 6.1, clip: 4.35, kept: 4.35, cutBefore: 0.82, cutAfter: 0.31, padBefore: 0, padAfter: 0,
//   pauses: [{ at: 2.4, was: 1.62, now: 0.6 }] }, check: { words: 14, meanScore: 0.86, lowWords: [['latency', 0.21]], letterMatch: 0.97 } }
```

The folder holds one recording per line (WAV or M4A, any name) and a `takes.json` that maps each line, as it is
said, to its file: `{ "One frame takes sixteen point six seven milliseconds.": "004.m4a" }`, every file inside the
folder. A line finds its take word by word, so case and punctuation do not matter, while "a part" is not "apart". A line with no take is refused, with every such line listed
and ready to paste into `takes.json`. The file names stay your recorder's, and an edited line is listed again
instead of being cut from a take of the old words. Each take then goes through four steps:

- **find**: its take in `takes.json`.
- **trim**: with ffmpeg, give every clip exactly the kit's 0.2 s before the first sound and 0.4 s after the last
  (a longer silence is cut, a shorter one padded), and shorten every pause longer than 0.6 s to 0.6 s. A short word
  at either end is kept; a click farther than 0.6 s from the speech is cut. The cut is computed in whole samples, so
  the same take always gives the same bytes.
- **align**: the kit's own MMS_FA aligner runs offline in the kit's Python, through `align_take.py`, which ships
  here. It never downloads: without the aligner's weights on disk, it refuses (run the kit's setup once).
- **check**: as the kit's `check_words.py` does it. A take the aligner cannot fit to its words is refused; a
  low-scored word is reported, for you to listen to.

What each step decided is the clip's `take` record, kept beside it in the cache.

The session's `profile` is a hash of the takes' bytes and the trim settings, so a recorded line and a cloned line of
the same text never share a key, and a line recorded again is never served stale. `voiceClips` refuses a recorded
engine with any other profile, and a recorded profile with any other engine. It also refuses a `work` folder that is
the takes folder, holds it or lies inside it, because a work folder is emptied before each batch.

- **Use a large `batch`.** Each batch loads the aligner's model once, about 2 s here, so `batch: 50` saves a load
  every few lines. The default stays 4 because batching is the cache's rule for every engine, and an interrupted run
  keeps each finished batch either way.
- **Reading clips without the takes.** `takes.profile` is two strings. Save it with the deck, and a machine without
  the recordings reads every clip with `clipFor(text, { cache, profile })`. `voiceClips` with no engine counts what
  is cached, and throws, as it always did, when a line is still to voice.
- **The limit:** the session cannot be pinned by name. Any change to the takes (a line recorded again, a new line, a
  trim setting) gives a new session, and every line is cut and aligned again. That takes seconds per line and
  generates no voice. A pinned id would let a line recorded again keep its old clip, because the cache never asks an
  engine about a clip it already has.

The voice is yours alone: never use this for anyone else's.

## API

| export | does |
|---|---|
| `spokenMap(text, { slots, rules })` | the text as shown and as spoken: `{ shown, spoken, pieces, norm }` |
| `autoRules({ spell, say })`, `SPELL`, `SAY` | the automatic strategy and its default lists |
| `checkSlots(text, slots, { name, field })`, `findSlot` | refuse a slot list that cannot be right; where a slot stands whole |
| `shownWords(map, words)` | timed spoken words, shown as written |
| `spokenOffset(map, at, { end })`, `unsaidDigits(map)` | a shown offset in the spoken text; the digits left to read |
| `numberWords(n)`, `normSpeech(text)` | a number in words; how two spellings are compared |
| `sentences`, `saidSentences`, `sentenceStarts` | split as a voice script splits; where each sentence starts |
| `captionCues(steps)`, `captionChunks(tracks, opts)`, `captionAt` | cues by sentence; chunks by word; the word being said |
| `captionFile(cues, kind, opts)`, `readCaptions`, `stamp`, `FILE_CHUNKS` | the one writer, its reader, its clock |
| `youtubeChapters(marks, { length, min })`, `readChapters`, `clockText` | chapters fixed and reported; read back; their clock |
| `/voice` `clipKey`, `clipFor`, `voiceClips`, `pickSteps`, `chatterboxKit`, `recordedTakes` | the clip cache and the voice port's two adapters |

Types ship with both doors (`index.d.ts`, `voice.d.ts`). Each `src/` folder has a README saying why it exists.

## What is guaranteed

- **Nothing a deck or a film already says changes.** The rules say exactly what StoryDeck 0.2.0 said, and the slots
  exactly what footprint-storyreel 0.9.0 said — pinned by property tests that compare thousands of generated texts
  against copies of that code, kept unedited in `test/control/`. The four clip-key goldens of a real deck stay.
- **The pieces always join back** to both texts, and only text said as written is ever rewritten: what a slot or
  a rule says is final.
- **The main door runs in a browser**: nothing it reaches imports a Node module (an architecture test).

The differences from the code it replaced are few and named in the [CHANGELOG](CHANGELOG.md).

## License

MIT
