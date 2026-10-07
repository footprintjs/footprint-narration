// narration — what a deck says on each click, as text a voice reads and captions follow. Pure; browser or Node.
//
//   narrationText(notes)              the speaker notes as a voice should read them
//   sentences(text)                   split as the voice splits them (after . ? or !)
//   captionCues(steps) → toSrt / toVtt   subtitles by sentence, timed by each clip's aligned sentence starts
//   chapterList(marks)                YouTube chapters ("0:00 Intro"), with YouTube's rules checked
//
// What a voice taught us, kept as defaults: an acronym stays as written (a cloned voice says LLM, HCI, MCP as
// quick letters; spaced out, "L L M" came out slow and odd), and only the ones it misreads as a word are spelled
// (SPELL: UI, API). Numbers become words, because a forced aligner only knows letters. `[draft]` marks a bridge
// line written for the deck, not the speaker's own words: it is said, and a listen panel shows it apart.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** A whole number (0 to 999,999) in words: 42 → "forty-two". */
export function numberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberWords(n % 100) : '');
  return numberWords(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + numberWords(n % 1000) : '');
}

/** Words a voice misreads as a word, and how to say them: spelled. Every other acronym stays as written. */
export const SPELL = Object.freeze({ UI: 'U I', API: 'A P I', APIs: 'A P Is' });

/**
 * A symbol standing alone, said as the word it means (a trailing . , ; : ! ? stays): & and, + plus, = equals,
 * < less than and > more than (before a number only: "File > Save As" is a menu path, a pause), × times,
 * % percent, and the Greek letters people write in talks.
 */
export const SAY = Object.freeze({
  '&': 'and', '+': 'plus', '=': 'equals', '<': 'less than', '>': 'more than', '×': 'times', '%': 'percent',
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', Δ: 'delta', ε: 'epsilon', θ: 'theta', λ: 'lambda', μ: 'mu',
  π: 'pi', σ: 'sigma', Σ: 'sigma', φ: 'phi', ω: 'omega', Ω: 'omega',
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a word's edge, Unicode-aware (\b only knows A–Z, 0–9 and _), written without lookbehind (older Safari)
const EDGE = '[^\\p{L}\\p{N}_]';
// symbols said only before a number: a comparison then, a menu path's arrow otherwise
const BEFORE_A_NUMBER = new Set(['<', '>']);
const lone = (keys) => new RegExp(`(^|\\s)(${keys.map(escapeRe).join('|')})`, 'gu');

/**
 * The notes (a string, or one string per note) as the voice should read them: [draft] marks dropped, the
 * `spell` words spelled, numbers as words, a lone symbol of `say` said, and any other word without a letter
 * (— – · → - / ... … -- -> * | an emoji) a pause: a comma on the word before it (or its sentence end, when it
 * carried one), nothing at the start. A voice aligner needs letters in every word. The local voice kit's
 * aligner knows Latin letters only: give a word in another script its reading with `spell` (`{ 日本: 'Japan' }`).
 */
export function narrationText(notes, { spell = SPELL, say = SAY } = {}) {
  let text = (Array.isArray(notes) ? notes : [notes ?? '']).join(' ').replace(/\[draft\]\s*/g, '');
  for (const [word, said] of Object.entries(spell)) text = text.replace(new RegExp(`(^|${EDGE})${escapeRe(word)}(?=${EDGE}|$)`, 'gu'), (_, edge) => edge + said);
  const compare = Object.keys(say).filter((k) => BEFORE_A_NUMBER.has(k)), symbols = Object.keys(say).filter((k) => !BEFORE_A_NUMBER.has(k));
  if (compare.length) text = text.replace(new RegExp(`${lone(compare).source}(?=\\s+[-+]?\\d)`, 'gu'), (_, edge, sym) => edge + say[sym]);
  text = text
    .replace(/\bp(\d+)\b/g, (_, d) => `p ${numberWords(Number(d))}`)
    .replace(/\b\d+\b/g, (d) => numberWords(Number(d)));
  if (symbols.length) text = text.replace(new RegExp(`${lone(symbols).source}([.,;:!?]*)(?=\\s|$)`, 'gu'), (_, edge, sym, end) => edge + say[sym] + end);
  return text.split(/\s+/).filter(Boolean).reduce(pause, []).join(' ');
}

/**
 * A word without a letter becomes a pause, dropped at the start: its sentence end (. ? !) moves onto the word
 * before it, so the voice still ends the sentence there; otherwise that word gets a comma (unless it ends in a
 * stop already).
 */
function pause(words, word) {
  if (/\p{L}/u.test(word)) { words.push(word); return words; }
  if (!words.length) return words;
  const last = words.length - 1, end = /[.?!]+$/.exec(word)?.[0];
  if (end) { if (!/[.?!]$/.test(words[last])) words[last] = words[last].replace(/[,;:]$/, '') + end; }
  else if (!/[,.;:!?]$/.test(words[last])) words[last] += ',';
  return words;
}

/** The notes as written, for captions: [draft] marks dropped, white space collapsed. */
export const writtenText = (notes) => (Array.isArray(notes) ? notes : [notes ?? '']).join(' ').replace(/\[draft\]\s*/g, '').replace(/\s+/g, ' ').trim();

/** Sentences as a voice script splits them: after . ? or ! and a space (no lookbehind: older Safari can't parse one). */
export const sentences = (text) => String(text ?? '').trim().replace(/([.?!])\s+/g, '$1\u0000').split('\u0000').filter(Boolean);

/**
 * The written sentences the voice says: one with no letter and no digit (a lone "...") is never said, so it
 * joins the sentence before it (or, at the start, the one after) — the written and the spoken text then
 * split alike.
 */
export function saidSentences(text) {
  const out = [];
  let lead = '';
  for (const s of sentences(text)) {
    if (/[\p{L}\p{N}]/u.test(s)) { out.push(lead + s); lead = ''; }
    else if (out.length) out[out.length - 1] += ` ${s}`;
    else lead += `${s} `;
  }
  return out;
}

/**
 * Subtitles by sentence. Each step: `start` (s, in the whole video), `lead` (s of silence before its clip),
 * `written` and `spoken` text, and its `clip` ({ duration, sentences: each sentence's start in the clip }).
 * A caption shows the text as written when it splits into as many sentences as the clip has; else as spoken.
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

const pad = (n, w = 2) => String(n).padStart(w, '0');
/** 3661.5 → "01:01:01,500" (SRT) or "01:01:01.500" (WebVTT). */
export function stamp(seconds, sep = ',') {
  const ms = Math.round(seconds * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
}

/** A caption's text can never hold a cue's arrow (a player would read it as a new timing line). */
const noArrow = (t) => t.replace(/-->/g, '→');

/** Cues as an .srt file. */
export const toSrt = (cues) => cues.map((q, i) => `${i + 1}\n${stamp(q.start)} --> ${stamp(q.end)}\n${noArrow(q.text)}\n`).join('\n');

/** Cues as a WebVTT file: & < > escaped, since WebVTT reads them as markup. */
export const toVtt = (cues) => `WEBVTT\n\n${cues.map((q) => `${stamp(q.start, '.')} --> ${stamp(q.end, '.')}\n${noArrow(q.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n`).join('\n')}`;

/** 95 → "1:35"; 3725 → "1:02:05" — a chapter's time, as YouTube reads it. */
export function clock(seconds) {
  const t = Math.floor(seconds), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * YouTube chapters from marks ({ at: seconds, title }), in time order: the text to paste into a
 * description, and what breaks YouTube's rules (the first at 0:00, at least three, each 10 s or more) —
 * `length` (the video's) lets the last one be checked too.
 */
export function chapterList(marks, { length } = {}) {
  const list = [...marks].sort((a, b) => a.at - b.at);
  const problems = [];
  if (!list.length || list[0].at > 0) problems.push('the first chapter must start at 0:00');
  if (list.length < 3) problems.push('YouTube shows chapters only when there are at least three');
  list.forEach((m, i) => {
    const end = list[i + 1]?.at ?? length;
    if (end !== undefined && end - m.at < 10) problems.push(`"${m.title}" is shorter than 10 s`);
  });
  return { text: list.map((m) => `${clock(m.at)} ${m.title}`).join('\n'), problems };
}
