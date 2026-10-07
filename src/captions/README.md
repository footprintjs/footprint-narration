# captions/ — one cue shape, two producers, one writer, one reader

**Why:** most people watch with the sound off, and every platform takes a caption file. A deck has sentence
times (each clip's sentence starts); a film has word times (the aligner's words). Both must end in the same
file, written one way — or a fix to the escaping or the wrap lands in one library and not the other.

```js
import { captionCues, captionChunks, captionFile, readCaptions, FILE_CHUNKS } from 'footprint-narration';

const bySentence = captionCues([{ start: 10, lead: 0.5, written: 'In 2000. Done.', spoken: 'In two thousand. Done.',
  clip: { duration: 4, sentences: [0.2, 2.5] } }]);                  // [{ start: 10.7, end: 13, text: 'In 2000.' }, …]
const words = [{ text: 'Two', start: 0.5, end: 0.75 }, { text: 'searches.', start: 1, end: 1.5 }];
const byWord = captionChunks([{ offset: 3, duration: 4, words }], FILE_CHUNKS);   // [{ start: 3.5, end: 5.1, text: 'Two searches.', words }]
captionFile(byWord, 'vtt', { offset: 2 });     // 'WEBVTT\n\n1\n00:00:05.500 --> 00:00:07.100\nTwo searches.\n'
readCaptions(file);                            // [{ start, end, text }] — both formats
```

- `cues.js` — `captionCues`: by sentence, as written when the sentences line up with the clip's, else as spoken.
- `chunks.js` — `captionChunks` / `captionAt` / `FILE_CHUNKS`: by word, on tracks (`{ offset, duration, words }`
  — a film's scene, a deck's click); a chunk takes one word more only to finish a clause.
- `file.js` — `captionFile` (numbered cues, `offset`, the `[from, to]` cut, two lines near the middle past
  `lineChars`, no `-->` inside a text, WebVTT's `& < >` escaped), `stamp`, and `readCaptions` (reads the escapes back).
