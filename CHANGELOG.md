# Changelog

## 0.2.0

Your own voice, recorded. A second adapter of the voice port voices a deck or a film from takes you read
yourself, lined up to their text the same way a cloned clip is.

- **voice** (`footprint-narration/voice`): `recordedTakes({ kit, takes, … })`.
  - **Find.** Each line's take is found through `takes.json` (text → file), matched word by word: "a part" is not
    "apart", while a curly quote or a dropped comma still finds its take. Every file must really be inside the
    takes folder (symlinks and the disk's own case are resolved), and every line without a take is refused at once,
    as lines ready to paste into `takes.json`.
  - **Trim.** ffmpeg cuts each take to exactly the kit's 0.2 s lead and 0.4 s tail, padding with silence where a
    take starts or ends at once, and caps inner pauses at 0.6 s. A short word at either end is kept.
  - **Align.** The kit's MMS_FA aligner runs offline through the shipped `align_take.py`, which refuses rather than
    downloads its weights.
  - **Check.** Words are scored as the kit's `check_words.py` scores them; low words are reported.
  - Each clip keeps a `take` record of what was cut, added and heard. The recording session is its own profile
    (`take-<hash>`), so a recorded and a cloned line of the same text never share a clip; `clipKey` is unchanged.
- `clipFor` returns a new `take` field (`null` for a clip a voice made).
- `voiceClips` hands every scene and the `work` folder to an engine's optional `preflight` before the first batch.
  It refuses a recorded engine with any other profile and a recorded profile with any other engine, and a `work`
  folder that is, holds or lies inside the takes folder (it is emptied before each batch). Calls with no engine and
  other engines' own `profile` fields behave as before.
- `chatterboxKit` takes an absolute `python` path as given.

## 0.1.0

The first release: the narration code that StoryDeck 0.2.0 and footprint-storyreel 0.9.0 each kept, moved into
one package both use.

- **spoken** — `spokenMap(text, { slots, rules })`: one text as shown and as spoken, piece by piece, with its
  letters-and-digits map. Slots (`checkSlots`, `findSlot`) come from footprint-storyreel's `say`; the automatic
  rules (`autoRules`, `SPELL`, `SAY`, `numberWords`) from StoryDeck's `narrationText`. `shownWords`,
  `spokenOffset`, `unsaidDigits` and `normSpeech` work on either.
- **sentences** — `sentences`, `saidSentences`, `sentenceStarts` (StoryDeck).
- **captions** — `captionCues` (StoryDeck), `captionChunks` / `captionAt` / `FILE_CHUNKS` (footprint-storyreel, now on
  tracks), ONE writer `captionFile` with `stamp`, and its reader `readCaptions` (footprint-storyreel).
- **chapters** — `youtubeChapters` (footprint-storyreel's rule, now with a report of what it changed), `clockText`,
  `readChapters`.
- **voice** (`footprint-narration/voice`, Node) — `clipKey`, `clipFor`, `voiceClips`, `pickSteps`, `chatterboxKit`
  (StoryDeck). A clip's `.json` now keeps its timed `words` too; `clipFor` returns them (`null` for a clip voiced
  before, or by an engine that aligns none). Clip keys are unchanged.

### Differences from the code it replaced

Pinned by the property tests in `test/`, which compare generated cases against copies of that code
(`test/control/`); each test leaves out exactly the cases named here.

From StoryDeck 0.2.0 (`storydeck/narration`, `storydeck/voice`):

- **What a rule says is final.** A spell value is not read again by a later spell entry or by the symbol rule:
  `{ A: 'B', B: 'C' }` says "B" (0.2.0 chained to "C"); `{ alpha: 'α' }` says "α" (0.2.0 then said "alpha").
- **A spell or say list is checked.** A key must be one word — not empty, no white space (0.2.0 also matched a
  multi-word key). A value must be words, a letter in every word, no digits, and no comma, semicolon or colon at
  its end: `{ Win: 'Windows 11' }` is refused (0.2.0 said "Windows eleven"); write `'Windows eleven'`. A value's
  white space is tidied — trimmed, one space inside — so `{ X: 'x ' }` no longer splits the word after it.
- **A million is a million.** Numbers from 1 000 000 are said in millions, billions and trillions (0.2.0 said
  "one thousand thousand"); a run of more than fifteen significant digits is said digit by digit (0.2.0 overflowed
  the stack past 308 digits). `numberWords` refuses anything but a whole number from 0 to 999 999 999 999 999.
  Every number under a million is said as before, zero-padded or not.
- **One caption writer.** WebVTT cues are numbered; a cue's text longer than 42 characters breaks onto two lines at
  the space nearest its middle (`lineChars: Infinity` keeps one; a long sentence makes long lines — nothing is cut);
  breaking white space in a text is one space (a no-break space stays); a cue shorter than 0.05 s, or with nothing
  to show, is left out. SRT files are otherwise as `toSrt` wrote them. `toSrt` / `toVtt` → `captionFile`.
- **Chapters are fixed, then reported.** `youtubeChapters` replaces `chapterList`: it moves the first chapter to
  0:00, lets an opening card under 10 s yield 0:00 to the next, merges a chapter shorter than 10 s into the one
  before, drops a last one shorter than 10 s — and lists each change. `problems` keeps only what it cannot fix
  (fewer than three). `clock` → `clockText`.
- `pickSteps` refuses anything but steps and ranges ("1-3,7"); 0.2.0 gave `NaN` steps. `voiceClips` works in a
  `footprint-narration-voice-` temporary folder and logs "N clips wanted · M to voice · the rest are cached".

From footprint-storyreel 0.9.0:

- `captionChunks` takes tracks (`[{ offset, duration, words }]`) instead of a film, and each chunk also carries its
  `text`. The chunks are otherwise the same, word for word and time for time.
- `captionFile` escapes WebVTT's `& < >`, never writes `-->` inside a text, makes breaking white space one space (a
  no-break space stays) and leaves out a cue with nothing to show; for every text without those, its bytes are the same.
- `readCaptions` also reads WebVTT's escapes (`&amp;` `&lt;` `&gt;` `&nbsp;` as a no-break space, `&lrm;` `&rlm;`) and a
  leading BOM.
- `youtubeChapters(marks, { length, min })` takes `[{ at, title }]` and returns `{ lines, text, kept, changes,
  problems }` (`lines` is what 0.9.0 returned); an hour is written `1:00:00` (0.9.0: `60:00`), and every mark past
  the video's end is dropped (0.9.0 dropped one). A title is one line (white space tidied); a mark without a title, or
  with a time that is not 0 or more seconds, is refused (0.9.0 wrote it as given).
- `findSlot` finds an empty shown text nowhere (0.9.0's, private there, would never return) and refuses a text
  that is not a string.
- `spokenMap` refuses a slot list `checkSlots` refuses (0.9.0's `slotPieces` stopped quietly at the first slot it
  could not find). `checkSlots` names the list by its `field` (`'slots'`; StoryReel passes `'say'`, so its
  messages are unchanged).
