# spoken/ — one text, as shown and as spoken

**Why:** a voice drops or garbles digits and a forced aligner knows only letters, so what a voice *says* differs
from what a caption *shows*: "16.67 ms" is said "sixteen point six seven milliseconds", "UI" is said "U I", and
"—" is not said at all. Every caption, every phrase match and every clip key rests on knowing exactly which
shown text became which spoken text. This folder owns that one law: **said in words, shown as written.**

```js
import { spokenMap, autoRules, shownWords } from 'footprint-narration';

const map = spokenMap('It took 1,250 ms — then 3 more.', {
  slots: [['1,250 ms', 'twelve hundred fifty milliseconds']],   // said by hand, where it stands
  rules: autoRules(),                                            // the rest, said automatically
});
map.spoken;   // 'It took twelve hundred fifty milliseconds, then three more.'
map.pieces;   // text · slot · pause (' —' → ',') · text · rule ('3' → 'three') · text
shownWords(map, alignedWords);   // the voice's timed words, shown as written: '1,250 ms,' … '3'
```

| file | owns |
|---|---|
| `map.js` | `spokenMap` (THE function), `spokenOffset`, `unsaidDigits`, the letters-and-digits map (`norm`) |
| `slots.js` | the explicit strategy: `findSlot`, `checkSlots` (StoryReel's refusals), the slot pieces |
| `rules.js` | the automatic strategy: `SPELL`, `SAY`, `autoRules` — spell, compare, numbers, symbols, pauses, in that order |
| `pieces.js` | the one rewrite step every rule uses: a match inside a text piece becomes a rule piece; said text is final |
| `pauses.js` | a word with no letter is not said: its sentence end moves onto the word before, else that word gets a comma |
| `shownWords.js` | timed spoken words back to what is shown (union of the words a piece touches, last piece first) |
| `digits.js` | `numberWords` (to the trillions; digit by digit past fifteen digits) |
| `normSpeech.js` | how two spellings are COMPARED (NFKC, letters + marks + digits, lower case) |

Two normalisations, on purpose: `normSpeech` answers "are these the same words?"; the rules' word edge
(`[^\p{L}\p{N}_]`, no lookbehind for older Safari) answers "where does this word end?" for a substitution.

**Laws** (each pinned by a property test): the pieces joined give back both texts exactly; only a `text` piece
is ever rewritten, so what a slot or a rule says is never read again; a pause never takes a mark from a slot or a
rule; the rules say exactly what StoryDeck 0.2.0 said (differential test, CONTROL = its `narration.js`), and the
slots exactly what footprint-storyreel 0.9.0 said, mapped and showed (CONTROL = its `clock.mjs`).
