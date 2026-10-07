// Caption cues by sentence, from each clip's sentence starts. Moved from StoryDeck 0.2.0 (narration.js · captionCues).
import { sentences, saidSentences } from '../sentences/sentences.js';

/**
 * Subtitles by sentence: [{ start, end, text }]. Each step: `start` (s, on the whole video), `lead` (s of silence
 * before its clip), the `written` and `spoken` text, and its `clip` ({ duration, sentences: each sentence's start
 * in the clip }). A caption shows the text as written when it splits into as many sentences as the clip has,
 * else as spoken; each from its start to the next one's (the last to the clip's end). A step without a clip,
 * or a clip without sentence starts, has no captions.
 */
export function captionCues(steps) {
  const cues = [];
  for (const step of steps) {
    const clip = step.clip;
    if (!clip?.sentences?.length) continue;
    const written = saidSentences(step.written), said = sentences(step.spoken);
    const text = written.length === clip.sentences.length ? written : said;
    const t0 = step.start + (step.lead ?? 0);
    text.slice(0, clip.sentences.length).forEach((t, j) => {
      const start = t0 + clip.sentences[j], end = t0 + (clip.sentences[j + 1] ?? clip.duration);
      if (end > start) cues.push({ start, end, text: t });
    });
  }
  return cues;
}
