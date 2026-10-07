// footprint-narration — what a voice says and what a caption shows. The pure door: runs anywhere (browser or
// Node); nothing beneath it imports a Node module. The voice port and the clip cache are behind
// 'footprint-narration/voice' (Node only).

// spoken — one text as shown and as spoken
export { normSpeech } from './src/spoken/normSpeech.js';
export { numberWords } from './src/spoken/digits.js';
export { SPELL, SAY, autoRules } from './src/spoken/rules.js';
export { findSlot, checkSlots } from './src/spoken/slots.js';
export { spokenMap, spokenOffset, unsaidDigits } from './src/spoken/map.js';
export { shownWords } from './src/spoken/shownWords.js';

// sentences — as a voice script splits them, and where each starts in a clip
export { sentences, saidSentences } from './src/sentences/sentences.js';
export { sentenceStarts } from './src/sentences/starts.js';

// captions — cues by sentence or by word, one file writer, its reader
export { captionCues } from './src/captions/cues.js';
export { captionChunks, captionAt, FILE_CHUNKS } from './src/captions/chunks.js';
export { stamp, captionFile, readCaptions } from './src/captions/file.js';

// chapters — YouTube's rule, its clock and its parser
export { clockText, readChapters, youtubeChapters } from './src/chapters/chapters.js';
