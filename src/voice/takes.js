// find — which recording says which line. A takes folder holds one recording per line (WAV or M4A, any name) and a
// takes.json that maps each line, as it is said, to its file: { "<the line>": "<file>" }. A line is matched to its
// take by its words (normSpeech: case, punctuation and spacing aside), so a deck's curly quote or a dropped comma
// still finds the take, and an edited line — other words — finds none and is listed for recording again.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { normSpeech } from '../spoken/normSpeech.js';

const RECIPE = 1;   // bump when a take's cut or alignment changes what its clip is: every session then gets a new id
const sha1 = (data) => createHash('sha1').update(data).digest('hex');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The takes.json of a folder, read and refused (naming the fix) when it is absent, not JSON, or not text → file. */
function readManifest(file) {
  if (!existsSync(file)) throw new Error(`recordedTakes: there is no ${path.basename(file)} at ${file} — write one that maps each line, as it is said, to its recording: { "<the line>": "<file>.m4a" }`);
  let book;
  try { book = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`recordedTakes: ${file} is not JSON (${e.message}): write { "<the line>": "<file>" }`); }
  if (!book || typeof book !== 'object' || Array.isArray(book)) throw new Error(`recordedTakes: ${file} must be one object of lines → files: { "<the line>": "<file>" }`);
  const bad = Object.entries(book).filter(([text, f]) => typeof f !== 'string' || !f.trim() || !normSpeech(text));
  if (bad.length) throw new Error(`recordedTakes: in ${file}, every key is a line with words and every value its recording's file name; fix ${bad.map(([text]) => JSON.stringify(text)).join(', ')}`);
  return book;
}

/**
 * The take book of a folder: { dir, manifest (its path), lines (Map: a line's words → { text, file, path }) }. Refused,
 * naming the fix, when takes.json names a file the folder does not have or gives two takes for the same words.
 */
export function readTakeBook(dir, manifest = 'takes.json') {
  const file = path.resolve(dir, manifest), lines = new Map(), absent = [], twice = [];
  for (const [text, name] of Object.entries(readManifest(file))) {
    const words = normSpeech(text), take = { text, file: name, path: path.resolve(dir, name) };
    if (!existsSync(take.path)) absent.push(name);
    if (lines.has(words)) twice.push(`${JSON.stringify(lines.get(words).text)} and ${JSON.stringify(text)}`);
    lines.set(words, take);
  }
  if (absent.length) throw new Error(`recordedTakes: ${path.basename(file)} names ${plural(absent.length, 'recording')} that ${dir} does not have: ${absent.join(', ')} — add the file(s), or fix the name(s)`);
  if (twice.length) throw new Error(`recordedTakes: ${path.basename(file)} gives two takes for the same words: ${twice.join('; ')} — keep one`);
  return { dir, manifest: file, lines };
}

/**
 * The take of each scene ({ id, text }): [{ id, text, file, path }]. Refuses with every line that has none, as
 * lines ready to paste into takes.json once recorded.
 */
export function findTakes(scenes, book) {
  const missing = [...new Set(scenes.filter((s) => !book.lines.has(normSpeech(s.text))).map((s) => s.text))];
  if (missing.length) {
    throw new Error(`recordedTakes: ${missing.length === 1 ? '1 line has' : `${missing.length} lines have`} no take in ${book.manifest}. Record each, then add it there (line → file):\n${missing.map((t) => `  ${JSON.stringify(t)}: "<file>.m4a"`).join(',\n')}`);
  }
  return scenes.map((s) => {
    const { file, path: at } = book.lines.get(normSpeech(s.text));
    return { id: s.id, text: s.text, file, path: at };
  });
}

/**
 * The voice profile of a recording session: { id: 'take-<12 hex>', engine: 'recorded' }. The id is already part of
 * the clip key's recipe (key.js · clipKey, unchanged), so a recorded line and a cloned line of the same text never
 * share a key. The id is a hash of what makes the clips: every take's words and bytes, and the trim settings.
 * Record a line again, add one, or change a setting, and the session is a new one: every line is cut and aligned
 * again (no voice is generated) — never a stale clip.
 */
export function sessionProfile(book, settings) {
  const takes = [...book.lines].sort(([a], [b]) => (a < b ? -1 : 1)).map(([words, t]) => [words, sha1(readFileSync(t.path))]);
  return { id: `take-${sha1(JSON.stringify({ recipe: RECIPE, trim: settings, takes })).slice(0, 12)}`, engine: 'recorded' };
}
