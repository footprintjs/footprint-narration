# sentences/ — split as a voice script splits

**Why:** a voice kit times sentences, a caption shows sentences, and a clip's cache keeps each sentence's start.
All three must split the same text the same way, or a caption shows one sentence while the voice says the next.

```js
import { sentences, saidSentences, sentenceStarts } from 'footprint-narration';

sentences('One. Two? Three! four');          // ['One.', 'Two?', 'Three!', 'four']
saidSentences('Done. ... Next.');            // ['Done. ...', 'Next.'] — a lone "..." is never said: it joins
sentenceStarts('Two words. Then three more!', alignedWords);   // [0.1, 1.2] — each sentence's first word
```

The split is after `. ? !` and white space, written without a lookbehind (older Safari cannot parse one).
StoryDeck's `listenRuntime` keeps an inline copy of this split, because a page runtime is serialised into the
page and cannot import; StoryDeck pins that copy against `saidSentences` with a test.
