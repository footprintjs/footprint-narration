# chapters/ — YouTube's chapter rule, fixed and reported

**Why:** YouTube shows chapters only when the first is at 0:00, there are at least three, and each lasts 10 s or
more — otherwise it silently shows none. One library fixed what it could and said nothing; the other said what was
wrong and fixed nothing. Here the rule fixes what it can **and** says what it did.

```js
import { youtubeChapters, readChapters, clockText } from 'footprint-narration';

const list = youtubeChapters([{ at: 0, title: 'Open' }, { at: 4, title: 'Title' }, { at: 30, title: 'Middle' }, { at: 95, title: 'End' }], { length: 120 });
list.lines;     // ['0:00 Title', '0:30 Middle', '1:35 End'] — an opening card under 10 s yields 0:00
list.changes;   // [{ kind: 'replaced', title: 'Open', at: 0, by: 'Title' }, { kind: 'moved', title: 'Title', at: 4, to: 0 }]
readChapters(list.text);   // back to [{ at, title }]
clockText(3725);           // '1:02:05'
```

Every mark is kept as it is or named once in `changes` (moved, replaced, merged, dropped); `problems` holds what
could not be fixed (fewer than three). The writer (`clockText`) and the reader (`readChapters`) live together.
