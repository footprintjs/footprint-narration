// align and check — each cut take's words timed against its KNOWN text by the voice kit's own aligner (MMS_FA, run
// by align_take.py with the kit's Python, offline), then checked as the kit's check_words.py checks a cloned line:
// a take the aligner cannot fit to its words is refused; low-scored words are reported, for a person to hear.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { failure } from './spawn.js';
import { wordsOf } from './takes.js';

/** The aligner this package ships (align_take.py, beside this file). */
export const ALIGNER = fileURLToPath(new URL('./align_take.py', import.meta.url));

/** The letters the aligner times for a word (align_take.py · norm, which is tts_chatterbox.py · norm). */
const letters = (word) => word.toLowerCase().replaceAll('’', "'").replace(/[^a-z']/g, '').replace(/^'+|'+$/g, '');

/** Refuses, all at once, the lines with a word the aligner cannot time (no letters: a digit, a symbol). */
export function refuseUnalignable(scenes) {
  const bad = scenes.map((s) => [s.text, wordsOf(s.text).filter((w) => !letters(w))]).filter(([, words]) => words.length);
  if (bad.length) {
    throw new Error(`recordedTakes: the aligner times letters, and these words have none: ${bad.map(([t, w]) => `${JSON.stringify(t)} (${w.join(' ')})`).join('; ')} — say them in words (spokenMap's autoRules, or a slot), as the take says them`);
  }
}

/**
 * Runs align_take.py on the cut takes in `dir` with the kit's Python (in the kit's folder, offline): → { timings,
 * checks } (Maps by take id) from its timings.json and word-check.json. Refuses, naming the fix, when it fails.
 */
export function alignTakes(cut, { dir, kit, python, env, run, profile }) {
  const board = path.join(dir, 'scenes.json');
  writeFileSync(board, JSON.stringify({ voiceProfile: profile.id, scenes: cut.map((t) => ({ id: t.id, text: t.text, audio: t.audio })) }, null, 1));
  const done = run(path.resolve(kit, python), [ALIGNER, '--scenes', board, '--out', dir], { cwd: kit, stdio: 'inherit', env: { ...env, HF_HUB_OFFLINE: env.HF_HUB_OFFLINE ?? '1' } });
  const why = failure(done);
  if (why) throw new Error(`the take aligner failed (${why}) with ${path.resolve(kit, python)}: it needs the kit's voice Python, with torch and torchaudio (the kit's setup-voice.sh), and the MMS_FA model on disk`);
  const read = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8')).scenes;
  return { timings: new Map(read('timings.json').map((s) => [s.id, s])), checks: new Map(read('word-check.json').map((c) => [c.scene, c])) };
}

/** Why a take fails its check, or null: the aligner fit every one of its words to it. */
function refusal(take, timing, check) {
  if (!timing || !check) return 'the aligner gave nothing back for it';
  if (check.failed) return `the aligner could not fit its words to it (${check.failed})`;
  const want = wordsOf(take.text).length;
  return timing.words.length === want ? null : `the aligner timed ${timing.words.length} of its ${want} words`;
}

/**
 * The checked takes, as the voice port gives them back: [{ id, audio, duration, words, take }] — `take` is the
 * record of how the clip was made: { file, trim, check: { words, meanScore, lowWords, letterMatch } }. Refuses,
 * all at once, every take its aligner could not fit to its line.
 */
export function checkTakes(cut, { timings, checks }, dir) {
  const refused = [], results = [];
  for (const take of cut) {
    const timing = timings.get(take.id), check = checks.get(take.id), why = refusal(take, timing, check);
    if (why) { refused.push(`${take.file} ("${take.text}"): ${why}`); continue; }
    const { words, meanScore, lowWords, letterMatch } = check;
    results.push({ id: take.id, audio: path.join(dir, timing.audio), duration: timing.duration, words: timing.words,
      take: { file: take.file, trim: take.trim, check: { words, meanScore, lowWords, letterMatch } } });
  }
  if (refused.length) throw new Error(`recordedTakes refused ${refused.length} take(s):\n  ${refused.join('\n  ')}\nIs each the take of its line? Record it again, or point takes.json at the right file.`);
  return results;
}

const s = (x) => `${x.toFixed(2)} s`;

/** One line a person reads: what was cut from a take and added to it, and how its words were heard. */
export function takeLine({ take: { file, trim, check } }) {
  const edits = [`cut ${s(trim.cutBefore)} before, ${s(trim.cutAfter)} after`], low = check.lowWords.map(([w, x]) => `"${w}" ${x}`);
  if (trim.padBefore || trim.padAfter) edits.push(`silence added ${s(trim.padBefore)} before, ${s(trim.padAfter)} after`);
  if (trim.pauses.length) edits.push(`pauses capped to ${s(trim.pauses[0].now)}: ${trim.pauses.map((p) => `${s(p.was)} at ${s(p.at)}`).join(', ')}`);
  return `take ${file}: ${s(trim.length)} → ${s(trim.clip)} (${edits.join('; ')})`
    + ` · ${check.words} words aligned, mean score ${check.meanScore}, letters ${check.letterMatch}${low.length ? ` · LOW, listen: ${low.join(', ')}` : ''}`;
}
