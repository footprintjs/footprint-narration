// Caption files — the one writer and its reader. The writer is footprint-storyreel 0.9.0's (captions.mjs ·
// captionFile: numbered cues, moved onto the video's clock, cut to a partial render, two lines at most) with
// StoryDeck 0.2.0's hygiene (narration.js · toVtt: no cue arrow inside a text, WebVTT's markup characters
// escaped); the reader is footprint-storyreel's (finished.mjs · readCaptions), which now also reads those escapes.

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 3661.25 → "01:01:01,250" (SRT) or, with sep '.', WebVTT's "01:01:01.250"; never below 0. */
export function stamp(seconds, sep = ',') {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
}

/** One line, or two split at the space nearest the middle. */
function twoLines(text, max) {
  if (text.length <= max) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

const VTT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
// White space a line may break at: every kind but the no-break ones (U+00A0, U+2007, U+202F, U+FEFF), which keep a number with its unit.
const BREAKING = /[^\S\u00a0\u2007\u202f\ufeff]+/g;
const escapeVtt = (t) => t.replace(/[&<>]/g, (c) => VTT_ESCAPES[c]);

/**
 * A cue's text as a file holds it: breaking white space as one space (a no-break space stays: "16.67 ms" is not
 * split), never a cue's arrow (a player would read `-->` as a new timing line, so it becomes →), and one line, or
 * two near the middle past `lineChars`. The words of a word-timed cue are joined when it has no `text`.
 */
function cueText(cue, lineChars) {
  if (typeof cue.text !== 'string' && !Array.isArray(cue.words)) throw new TypeError(`captionFile: a cue needs its text or its words, not ${JSON.stringify(cue)}`);
  const text = typeof cue.text === 'string' ? cue.text : cue.words.map((w) => w.text).join(' ');
  return twoLines(text.replace(BREAKING, ' ').trim().replace(/-->/g, '→'), lineChars);
}

/**
 * A caption file: WebVTT ('vtt') or SRT ('srt') text from cues ({ start, end, text } or { start, end, words }).
 * The cues move onto the video's clock: a cue at time t is written at t + offset, and only the cues inside
 * [from, to] are kept, cut at its edges (a sliver under 0.05 s is left out, as is a cue with no text). Cues are
 * numbered; a text longer than `lineChars` is split onto two lines near its middle; WebVTT's & < > are escaped.
 */
export function captionFile(cues, kind = 'vtt', { offset = 0, from = 0, to = Infinity, lineChars = 42 } = {}) {
  if (kind !== 'vtt' && kind !== 'srt') throw new Error(`captionFile: kind must be 'vtt' or 'srt', not ${JSON.stringify(kind)}`);
  const sep = kind === 'vtt' ? '.' : ',', lines = [];
  for (const c of cues) {
    const start = Math.max(c.start, from), end = Math.min(c.end, to), text = cueText(c, lineChars);
    if (end - start < 0.05 || !text) continue;
    lines.push(`${lines.length + 1}\n${stamp(start + offset, sep)} --> ${stamp(end + offset, sep)}\n${kind === 'vtt' ? escapeVtt(text) : text}\n`);
  }
  const body = lines.join('\n');
  return kind === 'vtt' ? `WEBVTT\n\n${body}` : body;
}

const VTT_REFERENCES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': '\u00a0', '&lrm;': '\u200e', '&rlm;': '\u200f' };

/** A caption file's cues: [{ start, end, text }] (WebVTT or SRT; a cue's lines joined by a space). */
export function readCaptions(text) {
  const time = (s) => { const p = s.trim().replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  const file = String(text).replace(/^﻿/, '').replace(/\r/g, '');
  const decode = /^WEBVTT/.test(file) ? (t) => t.replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (r) => VTT_REFERENCES[r]) : (t) => t;
  return file.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n'), at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) return null;
    const [a, b] = lines[at].split('-->');
    return { start: time(a), end: time(b.trim().split(/\s+/)[0]), text: decode(lines.slice(at + 1).join(' ').trim()) };
  }).filter(Boolean);
}
