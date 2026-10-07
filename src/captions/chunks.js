// Caption chunks from timed words. Moved from footprint-storyreel 0.9.0 (captions.mjs · captionChunks, captionAt,
// FILE_CHUNKS) — on tracks ({ offset, duration, words }) instead of a film, so a deck's clicks and a film's
// scenes are captioned alike.

// A sentence or clause may end inside a quote or a bracket: `tomorrow!"`, `me?'`, `done.”`, `(soon).`
const CLAUSE = /[.?!:;,—–]["'”’)\]]*$/, SENTENCE = /[.?!]["'”’)\]]*$/;
const said = (w) => String(w.text).replace(/[^\p{L}\p{N}]/gu, '');

/** The chunks a caption FILE uses by default: sentences, at most two lines of 42 characters. */
export const FILE_CHUNKS = Object.freeze({ maxWords: 16, maxChars: 84, breaks: 'sentence' });

function checkTrack(track, i) {
  if (!track || !Number.isFinite(track.offset) || !(Number.isFinite(track.duration) && track.duration >= 0) || !Array.isArray(track.words)) {
    throw new TypeError(`captionChunks: tracks[${i}] must be { offset, duration, words } in seconds on one clock (words: [{ text, start, end }] from the track's start), not ${JSON.stringify(track)}`);
  }
}

/**
 * Caption chunks: [{ start, end, text, words: [{ text, start, end }] }] on the tracks' shared clock — each track
 * a stretch of speech ({ offset, duration, words }: a film's scene, a deck's click), its word times from its start.
 *   maxWords  the most words in one chunk (4–5 reads well on a phone, 7 on a wide screen); a chunk takes one word
 *             more only to finish a clause, so no word is left standing alone
 *   maxChars  the most characters in one chunk, spaces counted (a file's cue: 84, two lines of 42)
 *   breaks    'clause' (after , ; : — and sentence ends) or 'sentence' (after . ? ! only)
 * A word with no letter or digit is never captioned. A chunk shows until the next one starts inside the same
 * track, else a moment (0.6 s) after its last word — never past the track's end.
 */
export function captionChunks(tracks, { maxWords = 5, maxChars = Infinity, breaks = 'clause' } = {}) {
  if (!(Number.isInteger(maxWords) && maxWords >= 1 && maxWords <= 20)) throw new Error(`captions.maxWords must be a whole number 1–20, not ${JSON.stringify(maxWords)}`);
  if (!(maxChars === Infinity || (Number.isInteger(maxChars) && maxChars >= 12))) throw new Error(`captions.maxChars must be a whole number of at least 12, not ${JSON.stringify(maxChars)}`);
  if (breaks !== 'clause' && breaks !== 'sentence') throw new Error(`captions.breaks must be 'clause' or 'sentence', not ${JSON.stringify(breaks)}`);
  if (!Array.isArray(tracks)) throw new TypeError('captionChunks: tracks must be a list of { offset, duration, words }');
  const ends = breaks === 'clause' ? CLAUSE : SENTENCE, chunks = [];
  tracks.forEach((track, i) => {
    checkTrack(track, i);
    const offset = track.offset, trackEnd = offset + track.duration;
    let current = [], chars = 0;
    const close = () => { if (current.length) chunks.push({ words: current, trackEnd }); current = []; chars = 0; };
    const words = track.words.filter(said);
    words.forEach((w, k) => {
      if (current.length && chars + 1 + w.text.length > maxChars) close();
      chars += (current.length ? 1 : 0) + w.text.length;
      current.push({ text: w.text, start: offset + w.start, end: offset + w.end });
      // Full at maxWords, unless the next word ends the clause and would otherwise stand alone.
      const next = words[k + 1], finishes = next && ends.test(next.text) && current.length === maxWords && chars + 1 + next.text.length <= maxChars;
      if ((current.length >= maxWords && !finishes) || ends.test(w.text)) close();
    });
    close();
  });
  return chunks.map((c, k) => {
    const next = chunks[k + 1], last = c.words.at(-1).end;
    const end = next && next.words[0].start < c.trackEnd ? next.words[0].start : Math.min(c.trackEnd, last + 0.6);
    return { start: c.words[0].start, end, text: c.words.map((w) => w.text).join(' '), words: c.words };
  });
}

/** The caption at t: { words, active } (active = the index of the word being said, or -1 between words), or null. */
export function captionAt(chunks, t) {
  const c = chunks.find((k) => t >= k.start && t < k.end);
  if (!c) return null;
  let active = -1;
  c.words.forEach((w, i) => { const next = c.words[i + 1]; if (t >= w.start && t < (next ? next.start : w.end + 0.25)) active = i; });
  return { words: c.words, active };
}
