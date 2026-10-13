// trim — a take's silences, measured and cut. Before the first sound and after the last, the take keeps the kit's
// own lead and tail (tts_chatterbox.py · main: 0.2 s and 0.4 s), so a recorded line sits in its clip as a cloned one
// does; every inner pause longer than `maxPause` is shortened to it, cut in its middle (auto-editor's silence
// cutting). The maths is here, in whole samples, so the same take always gives the same cut; ffmpeg decodes the
// recording and makes the cut, through filters (atrim + concat), with bit-exact output.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { readWav } from './wav.js';
import { failure, lastLine } from './spawn.js';

/**
 * The defaults. threshold: the level (dB below full scale, RMS per 10 ms) under which a take is silent. lead, tail:
 * the silence (s) kept before the first sound and after the last. maxPause: the longest inner pause (s) kept whole.
 * minSound: the shortest sound (s) that can start or end a take — a shorter one there (a click, a key) is silence.
 */
export const TRIM = Object.freeze({ threshold: -45, lead: 0.2, tail: 0.4, maxPause: 0.6, minSound: 0.1 });
const WINDOW = 0.01;   // s: a take's level is measured per 10 ms

/** The settings, the defaults filled in; refused, naming the fix, when one is not a setting or not a sound value. */
export function trimSettings(given = {}) {
  const s = { ...TRIM, ...given };
  for (const [name, value] of Object.entries(s)) {
    if (!(name in TRIM)) throw new RangeError(`trim.${name} is not a setting: the settings are ${Object.keys(TRIM).join(', ')}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`trim.${name} must be a number (got ${value})`);
  }
  if (s.threshold >= 0) throw new RangeError(`trim.threshold is a level below full scale: a negative number of dB, like ${TRIM.threshold} (got ${s.threshold})`);
  for (const name of ['lead', 'tail', 'minSound']) if (s[name] < 0) throw new RangeError(`trim.${name} is seconds, 0 or more (got ${s[name]})`);
  if (s.maxPause <= 0) throw new RangeError(`trim.maxPause is seconds, more than 0 (got ${s.maxPause}); to keep every pause whole, make it longer than any`);
  return Object.freeze(s);
}

/** Which 10 ms windows of a take are loud: their RMS level is at or above `threshold` dB below full scale. */
export function loudWindows(samples, rate, threshold) {
  const size = Math.max(1, Math.round(rate * WINDOW)), floor = (10 ** (threshold / 20) * 32768) ** 2, loud = [];
  for (let at = 0; at < samples.length; at += size) {
    const end = Math.min(samples.length, at + size);
    let sum = 0;
    for (let i = at; i < end; i++) sum += samples[i] * samples[i];
    loud.push(sum / (end - at) >= floor);
  }
  return { loud, size };
}

/** The runs of equal windows: [{ loud, start, end }] (windows, end exclusive). */
function runsOf(loud) {
  const runs = [];
  loud.forEach((l, i) => (runs.at(-1)?.loud === l ? (runs.at(-1).end = i + 1) : runs.push({ loud: l, start: i, end: i + 1 })));
  return runs;
}

/** Seconds, to the millisecond, of `n` samples. */
const seconds = (n, rate) => Math.round((n / rate) * 1000) / 1000;

/**
 * The cut of a take: `keep` — the sample spans [start, end) it keeps, in order — and `trim`, the verdict: the take's
 * length and the clip's (`kept`), the silence cut before the first sound and after the last, and each inner pause
 * capped ({ at, was, now }: where it started in the take, how long it was, how long it is now), all in seconds.
 * Null when the take has no sound at all.
 */
export function planTrim(samples, rate, settings) {
  const { loud, size } = loudWindows(samples, rate, settings.threshold), runs = runsOf(loud), total = samples.length;
  const sounds = runs.filter((r) => r.loud && (r.end - r.start) * size >= settings.minSound * rate);
  if (!sounds.length) return null;
  const first = sounds[0], last = sounds.at(-1), cap = Math.round(settings.maxPause * rate), before = Math.floor(cap / 2);
  const start = Math.max(0, first.start * size - Math.round(settings.lead * rate));
  const end = Math.min(total, last.end * size + Math.round(settings.tail * rate));
  // only the pauses between the first sound and the last: a short sound inside a take is never cut (it may be a word)
  const pauses = runs.filter((r) => !r.loud && r.start >= first.end && r.end <= last.start && (r.end - r.start) * size > cap);
  const keep = [];
  let from = start;
  for (const p of pauses) {
    keep.push([from, p.start * size + before]);
    from = p.end * size - (cap - before);
  }
  keep.push([from, end]);
  const kept = keep.reduce((n, [a, b]) => n + b - a, 0), s = (n) => seconds(n, rate);
  return { keep, trim: { length: s(total), kept: s(kept), cutBefore: s(start), cutAfter: s(total - end),
    pauses: pauses.map((p) => ({ at: s(p.start * size), was: s((p.end - p.start) * size), now: s(cap) })) } };
}

/** The ffmpeg filter graph that keeps `keep`'s sample spans of input 0, joined, as [out]. */
export function cutFilter(keep) {
  const parts = keep.map(([a, b], i) => `[0:a]atrim=start_sample=${a}:end_sample=${b},asetpts=PTS-STARTPTS[p${i}]`);
  return `${parts.join(';')};${keep.map((_, i) => `[p${i}]`).join('')}concat=n=${keep.length}:v=0:a=1[out]`;
}

const QUIET = ['-nostdin', '-hide_banner', '-v', 'error', '-y'];
const EXACT = ['-c:a', 'pcm_s16le', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact'];   // the same bytes on every run

/** ffmpeg's arguments to decode a recording (WAV, M4A, …) to a 16-bit mono PCM WAV at its own rate. */
export const decodeArgs = (take, out) => [...QUIET, '-i', take, '-map', '0:a:0', '-ac', '1', ...EXACT, out];

/** ffmpeg's arguments to cut a decoded take to `keep`'s spans. */
export const cutArgs = (decoded, keep, out) => [...QUIET, '-i', decoded, '-filter_complex', cutFilter(keep), '-map', '[out]', ...EXACT, out];

/** Runs ffmpeg; refuses, naming the take and its last error line, when it fails. */
function ffmpegOn(take, args, { ffmpeg, run }) {
  const done = run(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  const why = failure(done);
  if (why) throw new Error(`ffmpeg failed (${why}${lastLine(done)}) on the take ${take}: is ffmpeg installed (or passed as ffmpeg), and is the file a recording (WAV or M4A)?`);
}

/**
 * Trims each found take ({ id, text, file, path }) into `dir`/audio/<id>.wav, through `dir`/decoded/<id>.wav:
 * → [{ id, text, file, audio ('audio/<id>.wav'), trim }]. A take with no sound is refused, all such takes at once.
 */
export function trimTakes(found, dir, settings, tools) {
  for (const sub of ['decoded', 'audio']) mkdirSync(path.join(dir, sub), { recursive: true });
  const cut = [], silent = [];
  for (const take of found) {
    const decoded = path.join(dir, 'decoded', `${take.id}.wav`), audio = `audio/${take.id}.wav`;
    ffmpegOn(take.file, decodeArgs(take.path, decoded), tools);
    const { rate, samples } = readWav(decoded), plan = planTrim(samples, rate, settings);
    if (!plan) { silent.push(`${take.file} ("${take.text}")`); continue; }
    ffmpegOn(take.file, cutArgs(decoded, plan.keep, path.join(dir, audio)), tools);
    cut.push({ id: take.id, text: take.text, file: take.file, audio, trim: plan.trim });
  }
  if (silent.length) {
    throw new Error(`recordedTakes: no sound louder than ${settings.threshold} dB for ${settings.minSound} s in ${silent.join(', ')} — record them again, or set trim.threshold lower`);
  }
  return cut;
}
