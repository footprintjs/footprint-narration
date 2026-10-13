// find — which recording says which line. A takes folder holds one recording per line (WAV or M4A, any name) and a
// takes.json that maps each line, as it is said, to its file: { "<the line>": "<file>" }. A line is matched to its
// take by its words (matchKey: each word as normSpeech compares it, case and punctuation aside), so a deck's curly
// quote or a dropped comma still finds the take, while "a part" is not "apart", and an edited line — other words —
// finds none and is listed for recording again.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { normSpeech } from '../spoken/normSpeech.js';

// The take recipe's version: bump it when a take's match, cut or alignment changes what its clip is — every session
// then gets a new id. 2: lines matched word by word (matchKey); the exact lead and tail; a short word kept.
const RECIPE = 2;
const sha1 = (data) => createHash('sha1').update(data).digest('hex');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A line's words, as the aligner splits them (on white space). */
export const wordsOf = (text) => text.trim().split(/\s+/);

/** How a line finds its take: its words, each as normSpeech compares it, those with none dropped, one space between. */
export const matchKey = (text) => wordsOf(text).map(normSpeech).filter(Boolean).join(' ');

/**
 * Where a path really is: every symlink resolved, in the file system's own case (realpathSync.native — the plain
 * realpathSync keeps the case it is given, and on a case-insensitive disk TAKES is takes). A path that does not exist
 * yet is its nearest existing parent's real path with the rest appended.
 */
function realOf(p) {
  let at = path.resolve(p);
  const rest = [];
  while (!existsSync(at) && path.dirname(at) !== at) { rest.unshift(path.basename(at)); at = path.dirname(at); }
  return path.join(realpathSync.native(at), ...rest);
}

/** Is `inner` the folder `outer` or inside it? Asked of where both really are, never of how they are spelled. */
const within = (outer, inner) => {
  const rel = path.relative(realOf(outer), realOf(inner));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

/** The takes.json of a folder, read and refused (naming the fix) when it is absent, not JSON, or not text → file. */
function readManifest(file) {
  if (!existsSync(file)) throw new Error(`recordedTakes: there is no ${path.basename(file)} at ${file} — write one that maps each line, as it is said, to its recording: { "<the line>": "<file>.m4a" }`);
  let book;
  try { book = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`recordedTakes: ${file} is not JSON (${e.message}): write { "<the line>": "<file>" }`); }
  if (!book || typeof book !== 'object' || Array.isArray(book)) throw new Error(`recordedTakes: ${file} must be one object of lines → files: { "<the line>": "<file>" }`);
  const bad = Object.entries(book).filter(([text, f]) => typeof f !== 'string' || !f.trim() || !matchKey(text));
  if (bad.length) throw new Error(`recordedTakes: in ${file}, every key is a line with words and every value its recording's file name; fix ${bad.map(([text]) => JSON.stringify(text)).join(', ')}`);
  return book;
}

/** What is wrong with a take's file, or null: it must be a file inside the takes folder — really, a symlink followed. */
function fileProblem(dir, at) {
  if (!within(dir, at)) return 'outside';
  if (!existsSync(at)) return 'absent';
  return statSync(at).isFile() ? null : 'notFile';
}

const FILE_FIXES = {
  outside: (names, dir) => `names ${plural(names.length, 'file')} outside ${dir}: ${names.join(', ')} — keep every take inside the takes folder`,
  absent: (names, dir) => `names ${plural(names.length, 'recording')} that ${dir} does not have: ${names.join(', ')} — add the file(s), or fix the name(s)`,
  notFile: (names) => `names ${plural(names.length, 'path')} that are not files: ${names.join(', ')} — name each line's recording`,
};

/**
 * The take book of a folder: { dir, manifest (its path), lines (Map: a line's match key → { text, file, path }) }.
 * Refused, naming the fix, when takes.json names a file outside the folder, one it does not have or one that is
 * not a file, or gives two takes for the same words.
 */
export function readTakeBook(dir, manifest = 'takes.json') {
  const file = path.resolve(dir, manifest), lines = new Map(), wrong = { outside: [], absent: [], notFile: [] }, twice = [];
  for (const [text, name] of Object.entries(readManifest(file))) {
    const key = matchKey(text), take = { text, file: name, path: path.resolve(dir, name) }, problem = fileProblem(dir, take.path);
    if (problem) wrong[problem].push(name);
    if (lines.has(key)) twice.push(`${JSON.stringify(lines.get(key).text)} and ${JSON.stringify(text)}`);
    lines.set(key, take);
  }
  for (const [problem, names] of Object.entries(wrong)) if (names.length) throw new Error(`recordedTakes: ${path.basename(file)} ${FILE_FIXES[problem](names, dir)}`);
  if (twice.length) throw new Error(`recordedTakes: ${path.basename(file)} gives two takes for the same words: ${twice.join('; ')} — keep one`);
  return { dir, manifest: file, lines };
}

/**
 * Refuses a `work` folder that is the takes folder, holds it or lies inside it — where the folders really are, so a
 * symlink or another spelling of the case is no way past: a voice's work folder is emptied before each batch
 * (cache.js · voiceClips), and the takes are the owner's own recordings.
 */
export function refuseWorkOverTakes(work, book) {
  if (!work) return;
  const at = path.resolve(work), how = realOf(at) === realOf(book.dir) ? 'is' : within(at, book.dir) ? 'holds' : within(book.dir, at) ? 'is inside' : null;
  if (how) throw new Error(`recordedTakes: the work folder ${at} ${how} the takes folder ${book.dir}, and a work folder is emptied before each batch — give work a folder of its own, or leave it out`);
}

/**
 * The take of each scene ({ id, text }): [{ id, text, file, path }]. Refuses with every line that has none, as
 * lines ready to paste into takes.json once recorded.
 */
export function findTakes(scenes, book) {
  const missing = [...new Set(scenes.filter((s) => !book.lines.has(matchKey(s.text))).map((s) => s.text))];
  if (missing.length) {
    throw new Error(`recordedTakes: ${missing.length === 1 ? '1 line has' : `${missing.length} lines have`} no take in ${book.manifest}. Record each, then add it there (line → file):\n${missing.map((t) => `  ${JSON.stringify(t)}: "<file>.m4a"`).join(',\n')}`);
  }
  return scenes.map((s) => {
    const { file, path: at } = book.lines.get(matchKey(s.text));
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
  const takes = [...book.lines].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, t]) => [key, sha1(readFileSync(t.path))]);
  return { id: `take-${sha1(JSON.stringify({ recipe: RECIPE, trim: settings, takes })).slice(0, 12)}`, engine: 'recorded' };
}
