// The Chatterbox kit adapter — one adapter of the voice port ({ name, synthesize(scenes, { work }) }). Moved from
// StoryDeck 0.2.0 (voice.js · chatterboxKit). Bring another (a cloud voice, a test fake) with the same shape.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** Why a spawned process failed, or null when it ran and exited 0 (a missing binary or a signal is a failure). */
const failure = (done) => (done?.error ? done.error.message : done?.signal ? `signal ${done.signal}` : done?.status !== 0 ? `exit ${done?.status}` : null);

/**
 * The adapter for a local voice kit (a StoryReel-style folder): its Python environment runs Chatterbox on a
 * storyboard of scenes and writes timings.json (each scene's audio, duration and aligned words). Nothing is
 * uploaded. `kit` holds .venv-voice/, scripts/voice/tts_chatterbox.py, voices/<profile>.voice.json and the
 * profile's reference recording.
 */
export function chatterboxKit({ kit, python = '.venv-voice/bin/python', script = 'scripts/voice/tts_chatterbox.py', profile = 'voices/me.voice.json', device = 'mps', env = process.env, run = spawnSync }) {
  kit = path.resolve(kit);   // the kit runs in its own folder: every path it is handed is absolute
  return {
    name: 'chatterbox',
    synthesize(scenes, { work }) {
      const dir = path.resolve(work), board = path.join(dir, 'storyboard.json');
      writeFileSync(board, JSON.stringify({ scenes: scenes.map((s) => ({ id: s.id, narration: s.text })) }, null, 1));
      const done = run(path.join(kit, python), [script, '--storyboard', board, '--profile', profile, '--device', device, '--out', dir],
        { cwd: kit, stdio: 'inherit', env: { ...env, HF_HUB_OFFLINE: env.HF_HUB_OFFLINE ?? '1' } });
      const why = failure(done);
      if (why) throw new Error(`the voice kit failed (${why}) in ${kit}`);
      const timings = JSON.parse(readFileSync(path.join(dir, 'timings.json'), 'utf8'));
      return timings.scenes.map((s) => ({ id: s.id, audio: path.join(dir, s.audio), duration: s.duration, ...(s.words && { words: s.words }) }));
    },
  };
}
