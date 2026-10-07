// Where each sentence starts in a voiced clip. Moved from StoryDeck 0.2.0 (voice.js · sentenceStarts).
import { sentences } from './sentences.js';

/**
 * Where each sentence of `text` starts: its first word's aligned start, from the clip's timed `words` ({ start })
 * — a sentence's words counted by white space; 0 for a word the aligner lost.
 */
export function sentenceStarts(text, words) {
  let w = 0;
  return sentences(text).map((sentence) => { const first = words[w]; w += sentence.split(/\s+/).length; return first ? first.start : 0; });
}
