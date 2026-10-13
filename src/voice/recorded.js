// The recorded-take adapter — a second adapter of the voice port ({ name, synthesize(scenes, { work }) }), beside
// chatterbox.js: the owner reads each line himself, and every take is lined up to its text exactly as a cloned line
// is. Four steps per take, each with its verdict: find (takes.js) → trim (trim.js) → align → check (align.js).
// Only for your own voice: a take is a recording of you, reading your script.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readTakeBook, findTakes, sessionProfile } from './takes.js';
import { trimSettings, trimTakes } from './trim.js';
import { refuseUnalignable, alignTakes, checkTakes, takeLine } from './align.js';

/**
 * The adapter for a folder of recorded takes. `takes` holds one recording per line and its takes.json (`manifest`):
 * { "<the line, as it is said>": "<file>" }. `kit` is a voice kit whose Python (`python`) has torch and torchaudio:
 * it runs this package's align_take.py, offline. `trim` overrides trim.js · TRIM. The engine's `profile` is the
 * recording session's (takes.js · sessionProfile): pass it to voiceClips and clipFor, which refuse any other with
 * this engine. `preflight(scenes)` refuses, before any work, every line with no take. `log` gets one line per take.
 */
export function recordedTakes({ kit, takes, manifest = 'takes.json', python = '.venv-voice/bin/python', ffmpeg = 'ffmpeg', trim = {}, env = process.env, run = spawnSync, log = () => {} }) {
  for (const [name, value, what] of [['kit', kit, 'the voice kit folder, whose Python runs the aligner'], ['takes', takes, 'the folder of your recordings and their takes.json']]) {
    if (typeof value !== 'string' || !value) throw new TypeError(`recordedTakes: ${name} is ${what} (got ${value})`);
  }
  kit = path.resolve(kit);   // the aligner runs in the kit's folder: every path it is handed is absolute
  const settings = trimSettings(trim), book = readTakeBook(path.resolve(takes), manifest), profile = sessionProfile(book, settings);
  const find = (scenes) => { const found = findTakes(scenes, book); refuseUnalignable(scenes); return found; };
  return {
    name: 'recorded',
    profile,
    preflight(scenes) { find(scenes); },
    synthesize(scenes, { work }) {
      const dir = path.resolve(work);
      const cut = trimTakes(find(scenes), dir, settings, { ffmpeg, run });
      const results = checkTakes(cut, alignTakes(cut, { dir, kit, python, env, run, profile }), dir);
      for (const r of results) log(takeLine(r));
      return results;
    },
  };
}
