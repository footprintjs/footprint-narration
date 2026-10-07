// The clip cache — one clip per text, kept by its key (key.js), voiced only when its words or the voice change.
// Moved from StoryDeck 0.2.0 (voice.js · clipFor, voiceClips, pickSteps); a clip now keeps its timed words too.
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sentenceStarts } from '../sentences/starts.js';
import { clipKey } from './key.js';

/**
 * The cached clip for a text, or null: { key, audio (its .wav, else its .m4a), duration, sentences (each one's
 * start, s), words ([{ text, start, end }] as the voice's aligner timed them; null when it kept none — a clip
 * voiced before footprint-narration 0.1.0, or by an engine that aligns no words) }.
 */
export function clipFor(text, { cache, profile }) {
  if (!text) return null;
  cache = path.resolve(cache);
  const key = clipKey(text, profile), meta = path.join(cache, `${key}.json`);
  if (!existsSync(meta)) return null;
  const wav = path.join(cache, `${key}.wav`);
  const { duration, sentences, words } = JSON.parse(readFileSync(meta, 'utf8'));
  return { key, audio: existsSync(wav) ? wav : path.join(cache, `${key}.m4a`), duration, sentences, words: words ?? null };
}

/**
 * "1-3,7" → Set {1, 2, 3, 7}: the steps to work on (1-based, as a deck's URL #n counts clicks); null for all.
 * Refuses, naming the fix, anything else.
 */
export function pickSteps(spec) {
  if (spec === undefined || spec === null || !String(spec).trim()) return null;
  return new Set(String(spec).split(',').flatMap((part) => {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part), a = Number(m?.[1]), b = Number(m?.[2] ?? m?.[1]);
    if (!m || a < 1 || b < a) throw new RangeError(`pickSteps: "${part}" is not a step (1 or more) or a range of steps like 1-3`);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }));
}

/** The timed words a clip keeps: { text, start, end } each (an engine may give more; the cache keeps these). */
const keptWords = (words) => words.map((w) => ({ text: w.text, start: w.start, end: w.end }));

/**
 * Voices every text whose clip is not cached: `texts` (one per step, '' for none) → cache/<key>.wav + <key>.json
 * ({ text, duration, sentences, words } — `words` only when the engine aligned some). In batches of `batch`, each cached as soon as it is done, so an
 * interrupted run keeps every batch it finished; a text said on several steps is voiced once. `only` (a Set of
 * 1-based steps, pickSteps) narrows it. The engine works in `work` — a folder of its own, emptied before each batch
 * (by default a new temporary folder, removed afterwards). Returns { wanted, todo, voiced }.
 */
export async function voiceClips(texts, { cache, profile, engine, only = null, batch = 4, work, log = () => {} }) {
  if (!Number.isInteger(batch) || batch < 1) throw new RangeError(`batch must be a whole number of clips, 1 or more (got ${batch})`);
  cache = path.resolve(cache);
  mkdirSync(cache, { recursive: true });
  const todo = new Map();
  texts.forEach((text, i) => {
    if (!text || (only && !only.has(i + 1))) return;
    const key = clipKey(text, profile);
    if (!existsSync(path.join(cache, `${key}.json`))) todo.set(key, text);
  });
  const wanted = texts.filter(Boolean).length, keys = [...todo.keys()];
  log(`${wanted} clips wanted · ${todo.size} to voice · the rest are cached`);
  let voiced = 0;
  if (!keys.length) return { wanted, todo: 0, voiced };
  const own = !work, dir = own ? mkdtempSync(path.join(tmpdir(), 'footprint-narration-voice-')) : path.resolve(work);
  try {
    for (let b = 0; b < keys.length; b += batch) {
      const part = keys.slice(b, b + batch).filter((key) => !existsSync(path.join(cache, `${key}.json`)));   // another run may have voiced it
      if (!part.length) continue;
      rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      const results = await engine.synthesize(part.map((key) => ({ id: `k${key}`, text: todo.get(key) })), { work: dir });
      for (const r of results) {
        const key = r.id.slice(1), text = todo.get(key);
        copyFileSync(r.audio, path.join(cache, `${key}.wav`));
        rmSync(path.join(cache, `${key}.m4a`), { force: true });   // a page's copy of the old take would carry the new timings
        writeFileSync(path.join(cache, `${key}.json`), JSON.stringify({ text, duration: r.duration, sentences: sentenceStarts(text, r.words ?? []), ...(Array.isArray(r.words) && { words: keptWords(r.words) }) }));
      }
      voiced += results.length;
      log(`clips cached: ${voiced}/${keys.length}`);
    }
  } finally {
    if (own) rmSync(dir, { recursive: true, force: true });
  }
  return { wanted, todo: keys.length, voiced };
}
