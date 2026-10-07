/**
 * Captions: most people watch a post with the sound off. They are built from the word timings the film
 * already has (the voice's forced alignment, or even timings in a silent cut), so they say exactly what
 * is spoken, when it is spoken. A silent scene's directions are never captioned (they are not spoken).
 *
 * Two uses, one set of chunks:
 *   burned in  — short chunks (a few words, broken after punctuation), the word being said highlighted
 *                (layout.mjs draws them through drawCaption)
 *   a file     — WebVTT or SRT beside the video (captionFile), for players that show their own captions
 *                (YouTube, LinkedIn and X take a file): longer cues, broken at sentences, two lines at most
 */
// A sentence or clause may end inside a quote or a bracket: `tomorrow!"`, `me?'`, `done.”`, `(soon).`
const CLAUSE = /[.?!:;,—–]["'”’)\]]*$/, SENTENCE = /[.?!]["'”’)\]]*$/;
const spoken = w => String(w.text).replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Caption chunks for a film: [{start, end, words: [{text, start, end}]}] on the film clock.
 *   maxWords  the most words in one chunk (4–5 reads well on a phone, 7 on a wide screen); a chunk takes
 *             one word more only to finish a clause, so no word is left standing alone
 *   maxChars  the most characters in one chunk, spaces counted (a file's cue: 84, two lines of 42)
 *   breaks    'clause' (after , ; : — and sentence ends) or 'sentence' (after . ? ! only)
 */
export function captionChunks(film, {maxWords = 5, maxChars = Infinity, breaks = 'clause'} = {}) {
  if (!(Number.isInteger(maxWords) && maxWords >= 1 && maxWords <= 20)) throw new Error(`captions.maxWords must be a whole number 1–20, not ${JSON.stringify(maxWords)}`);
  if (!(maxChars === Infinity || (Number.isInteger(maxChars) && maxChars >= 12))) throw new Error(`captions.maxChars must be a whole number of at least 12, not ${JSON.stringify(maxChars)}`);
  if (breaks !== 'clause' && breaks !== 'sentence') throw new Error(`captions.breaks must be 'clause' or 'sentence', not ${JSON.stringify(breaks)}`);
  const ends = breaks === 'clause' ? CLAUSE : SENTENCE, chunks = [];
  film.timings.scenes.forEach((scene, i) => {
    if (scene.alignment?.method === 'directions') return;   // a silent scene: nothing is spoken
    const offset = film.clock.offsets[i], sceneEnd = offset + scene.duration;
    let current = [], chars = 0;
    const close = () => { if (current.length) chunks.push({words: current, sceneEnd}); current = []; chars = 0; };
    // Number slots show as written (clock.mjs · shownWords): the voice said words, the caption shows digits.
    const words = (film.clock.shownWords ? film.clock.shownWords(i) : scene.words ?? []).filter(spoken);
    words.forEach((w, k) => {
      if (current.length && chars + 1 + w.text.length > maxChars) close();
      chars += (current.length ? 1 : 0) + w.text.length;
      current.push({text: w.text, start: offset + w.start, end: offset + w.end});
      // Full at maxWords, unless the next word ends the clause and would otherwise stand alone.
      const next = words[k + 1], finishes = next && ends.test(next.text) && current.length === maxWords && chars + 1 + next.text.length <= maxChars;
      if ((current.length >= maxWords && !finishes) || ends.test(w.text)) close();
    });
    close();
  });
  // A chunk shows until the next one starts (in the same scene), or a moment after its last word.
  return chunks.map((c, k) => {
    const next = chunks[k + 1], last = c.words.at(-1).end;
    const end = next && next.words[0].start < c.sceneEnd ? next.words[0].start : Math.min(c.sceneEnd, last + .6);
    return {start: c.words[0].start, end, words: c.words};
  });
}

/** The caption at t: {words, active} (active = the index of the word being said, or -1 between words), or null. */
export function captionAt(chunks, t) {
  const c = chunks.find(k => t >= k.start && t < k.end);
  if (!c) return null;
  let active = -1;
  c.words.forEach((w, i) => { const next = c.words[i + 1]; if (t >= w.start && t < (next ? next.start : w.end + .25)) active = i; });
  return {words: c.words, active};
}

/**
 * Draw a caption centred in box [x, y, w, h] (output pixels): bold words on a soft dark pill, the word
 * being said in the accent colour. Long chunks wrap onto a second line.
 */
export function drawCaption(ctx, caption, [x, y, w, h], {size = 54, font = '"Helvetica Neue", Helvetica, Arial, sans-serif', ink = '#ffffff', accent = '#ffd34d', pill = 'rgba(20, 22, 30, .82)'} = {}) {
  if (!caption) return;
  ctx.save();
  ctx.font = `800 ${size}px ${font}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const space = ctx.measureText(' ').width, widths = caption.words.map(word => ctx.measureText(word.text).width);
  // Greedy wrap into lines that fit the box.
  const lines = [[]]; let lineWidth = 0;
  caption.words.forEach((_, i) => {
    const add = (lines.at(-1).length ? space : 0) + widths[i];
    if (lines.at(-1).length && lineWidth + add > w - size) { lines.push([]); lineWidth = 0; }
    lineWidth += (lines.at(-1).length ? space : 0) + widths[i]; lines.at(-1).push(i);
  });
  const lineH = size * 1.25, top = y + h / 2 - (lines.length * lineH) / 2;
  lines.forEach((line, n) => {
    const lw = line.reduce((s, i, k) => s + widths[i] + (k ? space : 0), 0), cy = top + lineH * (n + .5);
    let cx = x + w / 2 - lw / 2;
    ctx.fillStyle = pill; ctx.beginPath(); ctx.roundRect(cx - size * .35, cy - lineH / 2, lw + size * .7, lineH, lineH * .3); ctx.fill();
    for (const i of line) { ctx.fillStyle = i === caption.active ? accent : ink; ctx.fillText(caption.words[i].text, cx, cy + 1); cx += widths[i] + space; }
  });
  ctx.restore();
}

/** The chunks a caption FILE uses by default: sentences, at most two lines of 42 characters. */
export const FILE_CHUNKS = Object.freeze({maxWords: 16, maxChars: 84, breaks: 'sentence'});

/**
 * A caption file: WebVTT ('vtt') or SRT ('srt') text from caption chunks. The cues move onto the video's
 * clock: a chunk at film time t is written at t + offset, and only chunks inside [from, to] (film time)
 * are kept, cut at its edges. A cue longer than lineChars is split onto two lines near its middle.
 */
export function captionFile(chunks, kind = 'vtt', {offset = 0, from = 0, to = Infinity, lineChars = 42} = {}) {
  if (kind !== 'vtt' && kind !== 'srt') throw new Error(`captionFile: kind must be 'vtt' or 'srt', not ${JSON.stringify(kind)}`);
  const cues = [];
  for (const c of chunks) {
    const start = Math.max(c.start, from), end = Math.min(c.end, to);
    if (end - start < .05) continue;
    cues.push({start: start + offset, end: end + offset, text: twoLines(c.words.map(w => w.text).join(' '), lineChars)});
  }
  const sep = kind === 'vtt' ? '.' : ',';
  const stamp = s => { const ms = Math.round(Math.max(0, s) * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
  const body = cues.map((q, i) => `${i + 1}\n${stamp(q.start)} --> ${stamp(q.end)}\n${q.text}\n`).join('\n');
  return kind === 'vtt' ? `WEBVTT\n\n${body}` : body;
}

/** One line, or two split at the space nearest the middle. */
function twoLines(text, max) {
  if (text.length <= max) return text;
  const mid = text.length / 2; let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}
