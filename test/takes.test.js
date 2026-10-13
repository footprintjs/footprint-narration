// voice/ — the recorded-take adapter: find → trim → align → check, on synthetic takes (tones and silence written
// here as WAVs). ffmpeg and the kit's Python are stood in for by an injected `run`, as chatterboxKit's tests do: the
// real aligner never runs and nothing is downloaded. One test runs the real ffmpeg when it is installed, to show
// that the stand-in cuts as ffmpeg does.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { recordedTakes, voiceClips, clipFor, clipKey, chatterboxKit } from '../voice.js';
import { readWav } from '../src/voice/wav.js';
import { TRIM, trimSettings, loudWindows, planTrim, cutFilter, decodeArgs, cutArgs, trimTakes } from '../src/voice/trim.js';
import { ALIGNER } from '../src/voice/align.js';

const RATE = 16000;
const CLONED = { id: 'me', exaggeration: 0.5, cfgWeight: 0.5, seed: 7, sentenceGapSeconds: 0.3 };

/** A 16-bit PCM WAV of `samples` (a header as a recorder writes it; `channels`, `bits` and `tag` only to be refused). */
function wavBytes(samples, { rate = RATE, channels = 1, bits = 16, tag = 1, before = Buffer.alloc(0) } = {}) {
  const data = Buffer.alloc(samples.length * 2), head = Buffer.alloc(36);
  samples.forEach((x, i) => data.writeInt16LE(x, 2 * i));
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(28 + before.length + 8 + data.length, 4); head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii'); head.writeUInt32LE(16, 16); head.writeUInt16LE(tag, 20); head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE((rate * channels * bits) / 8, 28); head.writeUInt16LE((channels * bits) / 8, 32); head.writeUInt16LE(bits, 34);
  const dataHead = Buffer.alloc(8);
  dataHead.write('data', 0, 'ascii'); dataHead.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, before, dataHead, data]);
}

/** The samples of a take: parts of [seconds, amplitude] — 0 is silence, else a 440 Hz tone at that fraction of full scale. */
const samplesOf = (parts) => Int16Array.from(parts.flatMap(([secs, amp]) =>
  Array.from({ length: Math.round(secs * RATE) }, (_, i) => Math.round(amp * 32767 * Math.sin((2 * Math.PI * 440 * i) / RATE)))));
const wavOf = (parts) => wavBytes(samplesOf(parts));

// silence 0.5 · a word 1.0 · a pause 1.5 · a word 0.8 · silence 1.0 — 4.8 s
const TAKE = [[0.5, 0], [1, 0.5], [1.5, 0], [0.8, 0.5], [1, 0]];

/** ffmpeg, stood in for: a decode copies (these takes are 16-bit mono PCM already); a cut keeps its filter's atrim spans. */
function fakeFfmpeg(args) {
  const input = args[args.indexOf('-i') + 1], out = args.at(-1);
  if (!args.includes('-filter_complex')) { copyFileSync(input, out); return { status: 0 }; }
  const { rate, samples } = readWav(input), graph = args[args.indexOf('-filter_complex') + 1];
  const kept = [...graph.matchAll(/start_sample=(\d+):end_sample=(\d+)/g)].flatMap((m) => [...samples.slice(Number(m[1]), Number(m[2]))]);
  writeFileSync(out, wavBytes(kept, { rate }));
  return { status: 0 };
}

/**
 * The kit's Python running align_take.py, stood in for: every word timed evenly, mean score 0.9, letters 1; `low`
 * scores words low, `failed` refuses a line (by text), `short` times one word fewer, `lose` gives nothing back.
 */
function fakeAligner(args, { low = {}, failed = {}, short = [], lose = [] }) {
  const board = JSON.parse(readFileSync(args[args.indexOf('--scenes') + 1], 'utf8')), out = args[args.indexOf('--out') + 1], scenes = [], checks = [];
  for (const s of board.scenes.filter((x) => !lose.includes(x.text))) {
    const { rate, samples } = readWav(path.join(out, s.audio)), duration = samples.length / rate, tokens = s.text.split(/\s+/);
    if (failed[s.text]) {
      scenes.push({ id: s.id, duration, audio: s.audio, provider: 'recorded', words: [], alignment: { status: 'failed', reason: failed[s.text] } });
      checks.push({ scene: s.id, words: tokens.length, meanScore: null, lowWords: [], letterMatch: null, failed: failed[s.text] });
      continue;
    }
    const step = duration / tokens.length, timed = tokens.slice(0, short.includes(s.text) ? -1 : undefined);
    scenes.push({ id: s.id, duration, audio: s.audio, provider: 'recorded', words: timed.map((t, i) => ({ text: t, start: i * step, end: (i + 1) * step })) });
    checks.push({ scene: s.id, words: tokens.length, meanScore: 0.9, lowWords: tokens.filter((t) => low[t]).map((t) => [t, low[t]]), letterMatch: 1 });
  }
  writeFileSync(path.join(out, 'timings.json'), JSON.stringify({ schemaVersion: 1, provider: 'recorded', voiceProfile: board.voiceProfile, scenes }));
  writeFileSync(path.join(out, 'word-check.json'), JSON.stringify({ schemaVersion: 1, lowThreshold: 0.3, scenes: checks }));
  return { status: 0 };
}

/** A `run` standing in for both tools, remembering every call. */
function tools(aligner = {}) {
  const calls = [];
  const run = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return cmd === 'ffmpeg' ? fakeFfmpeg(args) : fakeAligner(args, aligner); };
  return { calls, run };
}

let dir;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'fn-takes-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A takes folder: { line: [file, parts] } → the recordings and their takes.json. */
function takesFolder(lines, name = 'takes') {
  const folder = path.join(dir, name), book = {};
  mkdirSync(folder, { recursive: true });
  for (const [text, [file, parts]] of Object.entries(lines)) { writeFileSync(path.join(folder, file), wavOf(parts)); book[text] = file; }
  writeFileSync(path.join(folder, 'takes.json'), JSON.stringify(book, null, 1));
  return folder;
}

test('trim maths: the kit\'s lead and tail kept, a long pause capped in its middle — in whole samples', () => {
  const plan = planTrim(samplesOf(TAKE), RATE, TRIM);
  // first sound at 0.5 s → start 0.3 s; last sound ends at 3.8 s → end 4.2 s; the 1.5 s pause keeps 0.3 s each side
  assert.deepEqual(plan.keep, [[4800, 28800], [43200, 67200]]);
  assert.deepEqual(plan.trim, { length: 4.8, kept: 3, cutBefore: 0.3, cutAfter: 0.6, pauses: [{ at: 1.5, was: 1.5, now: 0.6 }] });
  assert.equal(cutFilter(plan.keep), '[0:a]atrim=start_sample=4800:end_sample=28800,asetpts=PTS-STARTPTS[p0];'
    + '[0:a]atrim=start_sample=43200:end_sample=67200,asetpts=PTS-STARTPTS[p1];[p0][p1]concat=n=2:v=0:a=1[out]');
  assert.deepEqual(planTrim(samplesOf(TAKE), RATE, TRIM), plan, 'the same take, the same cut');
  const loose = planTrim(samplesOf(TAKE), RATE, trimSettings({ lead: 0, tail: 0, maxPause: 2 }));
  assert.deepEqual(loose.keep, [[8000, 60800]], 'no lead, no tail, the pause kept whole');
});

test('trim maths: a short lead stays whole, a pause under the cap is untouched, a click does not start a take, a short sound inside is never cut', () => {
  const near = planTrim(samplesOf([[0.1, 0], [0.5, 0.5], [0.4, 0], [0.5, 0.5], [0.2, 0]]), RATE, TRIM);
  assert.deepEqual(near.keep, [[0, 27200]]);
  assert.deepEqual(near.trim, { length: 1.7, kept: 1.7, cutBefore: 0, cutAfter: 0, pauses: [] });
  const click = planTrim(samplesOf([[0.5, 0], [0.03, 0.8], [0.5, 0], [1, 0.5], [0.5, 0]]), RATE, TRIM);
  assert.equal(click.trim.cutBefore, 0.83, 'the click before the first word is cut with the silence');
  assert.equal(planTrim(samplesOf([[0.5, 0], [0.03, 0.8], [0.5, 0], [1, 0.5], [0.5, 0]]), RATE, trimSettings({ minSound: 0 })).trim.cutBefore, 0.3, 'minSound 0: the click starts the take');
  const inner = planTrim(samplesOf([[0.3, 0], [0.5, 0.5], [1, 0], [0.05, 0.5], [1, 0], [0.5, 0.5], [0.3, 0]]), RATE, TRIM);
  assert.deepEqual(inner.trim.pauses, [{ at: 0.8, was: 1, now: 0.6 }, { at: 1.85, was: 1, now: 0.6 }], 'each side of the short sound is a pause of its own');
  assert.equal(inner.trim.kept, 2.75);
  assert.ok(inner.keep.some(([a, b]) => a <= 1.8 * RATE && b >= 1.85 * RATE), 'the 0.05 s sound is kept');
});

test('trim maths: under the threshold is silence; a take with no sound has no cut; windows of 10 ms, the last one short', () => {
  const hum = samplesOf([[1, 0.001]]);   // about -63 dB
  assert.equal(planTrim(hum, RATE, TRIM), null);
  assert.equal(planTrim(samplesOf([[1, 0]]), RATE, TRIM), null);
  assert.deepEqual(planTrim(hum, RATE, trimSettings({ threshold: -70 })).trim.kept, 1, 'heard at -70 dB');
  const { loud, size } = loudWindows(samplesOf([[0.01, 0], [0.0003, 0.5]]), RATE, -45);
  assert.equal(size, 160);
  assert.deepEqual(loud, [false, true]);
  assert.equal(loudWindows(new Int16Array(3), 10, -45).size, 1, 'a window is one sample at the least');
});

test('trim settings: the defaults, an override, and each refusal names the fix', () => {
  assert.deepEqual(trimSettings(), TRIM);
  assert.equal(trimSettings({ maxPause: 1 }).maxPause, 1);
  assert.ok(Object.isFrozen(trimSettings({ lead: 0 })));
  assert.throws(() => trimSettings({ pause: 1 }), { name: 'RangeError', message: 'trim.pause is not a setting: the settings are threshold, lead, tail, maxPause, minSound' });
  assert.throws(() => trimSettings({ lead: '0.2' }), /trim\.lead must be a number \(got 0\.2\)/);
  assert.throws(() => trimSettings({ tail: NaN }), /trim\.tail must be a number/);
  assert.throws(() => trimSettings({ threshold: 3 }), /a negative number of dB, like -45 \(got 3\)/);
  assert.throws(() => trimSettings({ minSound: -1 }), /trim\.minSound is seconds, 0 or more/);
  assert.throws(() => trimSettings({ maxPause: 0 }), /trim\.maxPause is seconds, more than 0 \(got 0\); to keep every pause whole, make it longer than any/);
});

test('the decoded take is read back as samples; any other file is refused, naming what it is', () => {
  const file = path.join(dir, 'a.wav'), at = (bytes) => { writeFileSync(file, bytes); return file; };
  assert.deepEqual(readWav(at(wavBytes([1, -2, 3], { rate: 24000 }))), { rate: 24000, samples: Int16Array.from([1, -2, 3]) });
  const odd = Buffer.concat([Buffer.from('LIST'), Buffer.from([3, 0, 0, 0]), Buffer.from('abc'), Buffer.alloc(1)]);
  assert.deepEqual([...readWav(at(wavBytes([5, 6], { before: odd }))).samples], [5, 6], 'a chunk of odd size, padded, before the data');
  assert.deepEqual([...readWav(at(wavBytes([7], { tag: 0xfffe }))).samples], [7], 'the extensible format, 16-bit mono');
  assert.throws(() => readWav(at(wavBytes([1, 2], { channels: 2 }))), /is not 16-bit mono PCM \(2 channel\(s\), 16-bit, format 1\): decode it first/);
  assert.throws(() => readWav(at(wavBytes([1, 2], { bits: 24 }))), /\(1 channel\(s\), 24-bit, format 1\)/);
  assert.throws(() => readWav(at(wavBytes([1], { tag: 3 }))), /format 3/);
  assert.throws(() => readWav(at(Buffer.from('not audio at all'))), /is not a WAV file/);
  assert.throws(() => readWav(at(Buffer.from('RIFF'))), /is not a WAV file/);
  assert.throws(() => readWav(at(wavBytes([1]).subarray(0, 36))), /has no audio data/);
  const noFmt = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEdata'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(2)]);
  assert.throws(() => readWav(at(noFmt)), /no format before its data/);
});

test('find: a line finds its take by its words — case, punctuation and spacing aside', () => {
  const takes = takesFolder({ 'Hello, world!': ['a.wav', TAKE] });
  const engine = recordedTakes({ kit: dir, takes, run: tools().run });
  assert.equal(engine.name, 'recorded');
  assert.doesNotThrow(() => engine.preflight([{ id: 'k1', text: 'hello   world' }, { id: 'k2', text: 'Hello, World.' }]));
});

test('find: every line with no take is refused at once, as lines to paste into takes.json', () => {
  const takes = takesFolder({ 'One.': ['1.wav', TAKE] }), engine = recordedTakes({ kit: dir, takes, run: tools().run });
  const scenes = [{ id: 'k1', text: 'One.' }, { id: 'k2', text: 'Two.' }, { id: 'k3', text: 'It’s “three”.' }, { id: 'k4', text: 'Two.' }];
  const said = `recordedTakes: 2 lines have no take in ${path.join(takes, 'takes.json')}. Record each, then add it there (line → file):\n`
    + '  "Two.": "<file>.m4a",\n  "It’s “three”.": "<file>.m4a"';
  assert.throws(() => engine.preflight(scenes), { message: said });
  assert.throws(() => engine.synthesize(scenes, { work: path.join(dir, 'w') }), { message: said });
  assert.throws(() => engine.preflight([{ id: 'k2', text: 'Two.' }]), /^Error: recordedTakes: 1 line has no take/);
});

test('find: takes.json is refused, naming the fix — absent, not JSON, not an object, a value not a file, a file not there, two takes for the same words', () => {
  const folder = path.join(dir, 'takes'), book = path.join(folder, 'takes.json'), open = () => recordedTakes({ kit: dir, takes: folder, run: tools().run });
  mkdirSync(folder);
  assert.throws(open, { message: `recordedTakes: there is no takes.json at ${book} — write one that maps each line, as it is said, to its recording: { "<the line>": "<file>.m4a" }` });
  writeFileSync(book, '{ "One.": ');
  assert.throws(open, /takes\.json is not JSON \(.+\): write \{ "<the line>": "<file>" \}/);
  for (const shape of ['[]', 'null', '"one.wav"']) { writeFileSync(book, shape); assert.throws(open, /must be one object of lines → files/); }
  writeFileSync(book, JSON.stringify({ 'One.': 1, 'Two.': ' ', '—': 'x.wav', 'Fine.': 'f.wav' }));
  assert.throws(open, /every key is a line with words and every value its recording's file name; fix "One\.", "Two\.", "—"/);
  writeFileSync(book, JSON.stringify({ 'One.': 'one.wav', 'Two.': 'two.m4a' }));
  assert.throws(open, { message: `recordedTakes: takes.json names 2 recordings that ${folder} does not have: one.wav, two.m4a — add the file(s), or fix the name(s)` });
  writeFileSync(path.join(folder, 'one.wav'), wavOf(TAKE));
  writeFileSync(book, JSON.stringify({ 'One.': 'one.wav', 'one': 'one.wav', 'ONE!': 'one.wav' }));
  assert.throws(open, { message: 'recordedTakes: takes.json gives two takes for the same words: "One." and "one"; "one" and "ONE!" — keep one' });
  writeFileSync(path.join(folder, 'lines.json'), JSON.stringify({ 'One.': 'one.wav' }));
  assert.equal(recordedTakes({ kit: dir, takes: folder, manifest: 'lines.json', run: tools().run }).name, 'recorded', 'a manifest of another name');
  assert.throws(() => recordedTakes({ kit: dir, takes: folder, manifest: 'lines.json', trim: { pause: 1 } }), /trim\.pause is not a setting/);
  assert.throws(() => recordedTakes({ kit: dir }), { name: 'TypeError', message: 'recordedTakes: takes is the folder of your recordings and their takes.json (got undefined)' });
  assert.throws(() => recordedTakes({ takes: folder }), /^TypeError: recordedTakes: kit is the voice kit folder, whose Python runs the aligner \(got undefined\)/);
});

test('the session profile: the same takes, the same id; a take recorded again, a new line or another trim setting, a new one — never a cloned voice\'s key', () => {
  const takes = takesFolder({ 'One.': ['1.wav', TAKE], 'Two.': ['2.wav', TAKE] }), run = tools().run;
  const profile = recordedTakes({ kit: dir, takes, run }).profile;
  assert.match(profile.id, /^take-[0-9a-f]{12}$/);
  assert.equal(profile.engine, 'recorded');
  assert.deepEqual(recordedTakes({ kit: dir, takes, run }).profile, profile, 'read again: the same session');
  assert.notEqual(clipKey('One.', profile), clipKey('One.', CLONED), 'a recorded line and a cloned line of one text: two keys');
  assert.notEqual(recordedTakes({ kit: dir, takes, run, trim: { maxPause: 0.8 } }).profile.id, profile.id);
  writeFileSync(path.join(takes, '2.wav'), wavOf([[0.2, 0], [1, 0.4], [0.2, 0]]));
  const again = recordedTakes({ kit: dir, takes, run }).profile;
  assert.notEqual(again.id, profile.id, 'a line recorded again');
  writeFileSync(path.join(takes, 'takes.json'), JSON.stringify({ 'One.': '1.wav', 'Two.': '2.wav', 'Three.': '2.wav' }));
  assert.notEqual(recordedTakes({ kit: dir, takes, run }).profile.id, again.id, 'a new line');
  writeFileSync(path.join(takes, 'takes.json'), JSON.stringify({ 'two': '2.wav', 'one': '1.wav' }));
  assert.equal(recordedTakes({ kit: dir, takes, run }).profile.id, again.id, 'the order and spelling of takes.json aside');
});

test('refused before any work: a line with a word the aligner cannot time', () => {
  const takes = takesFolder({ 'Wait 16.67 ms — now.': ['a.wav', TAKE] }), { calls, run } = tools();
  const engine = recordedTakes({ kit: dir, takes, run });
  const said = 'recordedTakes: the aligner times letters, and these words have none: "Wait 16.67 ms — now." (16.67 —) — say them in words (spokenMap\'s autoRules, or a slot), as the take says them';
  assert.throws(() => engine.preflight([{ id: 'k1', text: 'Wait 16.67 ms — now.' }]), { message: said });
  assert.throws(() => engine.synthesize([{ id: 'k1', text: 'Wait 16.67 ms — now.' }], { work: path.join(dir, 'w') }), { message: said });
  assert.equal(calls.length, 0);
  assert.doesNotThrow(() => recordedTakes({ kit: dir, takes: takesFolder({ "Rock'n'roll, ’em.": ['r.wav', TAKE] }, 't2'), run }).preflight([{ id: 'k', text: "Rock'n'roll, ’em." }]));
});

test('synthesize: find → trim → align → check, each take lined up to its text, with its record', () => {
  const takes = takesFolder({ 'Hello world.': ['a.wav', TAKE], 'Short one.': ['b.m4a', [[0.1, 0], [1, 0.5], [0.3, 0]]] });
  const work = path.join(dir, 'work'), lines = [], { calls, run } = tools({ low: { 'world.': 0.21 } });
  mkdirSync(work);
  const engine = recordedTakes({ kit: path.join(dir, 'kit'), takes, run, env: {}, log: (l) => lines.push(l) });
  const results = engine.synthesize([{ id: 'ka', text: 'Hello world.' }, { id: 'kb', text: 'Short one.' }], { work });
  const keepA = [[4800, 28800], [43200, 67200]];
  assert.deepEqual(calls.map((c) => [c.cmd, c.args]), [
    ['ffmpeg', decodeArgs(path.join(takes, 'a.wav'), path.join(work, 'decoded', 'ka.wav'))],
    ['ffmpeg', cutArgs(path.join(work, 'decoded', 'ka.wav'), keepA, path.join(work, 'audio', 'ka.wav'))],
    ['ffmpeg', decodeArgs(path.join(takes, 'b.m4a'), path.join(work, 'decoded', 'kb.wav'))],
    ['ffmpeg', cutArgs(path.join(work, 'decoded', 'kb.wav'), [[0, 22400]], path.join(work, 'audio', 'kb.wav'))],
    [path.join(dir, 'kit', '.venv-voice', 'bin', 'python'), [ALIGNER, '--scenes', path.join(work, 'scenes.json'), '--out', work]],
  ]);
  assert.deepEqual(calls[0].opts, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  assert.deepEqual({ cwd: calls[4].opts.cwd, offline: calls[4].opts.env.HF_HUB_OFFLINE }, { cwd: path.join(dir, 'kit'), offline: '1' });
  assert.ok(existsSync(ALIGNER) && ALIGNER.endsWith(path.join('src', 'voice', 'align_take.py')), 'the aligner ships in the package');
  assert.deepEqual(JSON.parse(readFileSync(path.join(work, 'scenes.json'), 'utf8')), { voiceProfile: engine.profile.id,
    scenes: [{ id: 'ka', text: 'Hello world.', audio: 'audio/ka.wav' }, { id: 'kb', text: 'Short one.', audio: 'audio/kb.wav' }] });
  assert.equal(readWav(results[0].audio).samples.length, 48000, 'the clip is the cut: 3 s');
  assert.deepEqual(results[0], { id: 'ka', audio: path.join(work, 'audio', 'ka.wav'), duration: 3,
    words: [{ text: 'Hello', start: 0, end: 1.5 }, { text: 'world.', start: 1.5, end: 3 }],
    take: { file: 'a.wav', trim: { length: 4.8, kept: 3, cutBefore: 0.3, cutAfter: 0.6, pauses: [{ at: 1.5, was: 1.5, now: 0.6 }] },
      check: { words: 2, meanScore: 0.9, lowWords: [['world.', 0.21]], letterMatch: 1 } } });
  assert.deepEqual(lines, [
    'take a.wav: 4.80 s → 3.00 s (cut 0.30 s before, 0.60 s after; pauses capped to 0.60 s: 1.50 s at 1.50 s) · 2 words aligned, mean score 0.9, letters 1 · LOW, listen: "world." 0.21',
    'take b.m4a: 1.40 s → 1.40 s (cut 0.00 s before, 0.00 s after) · 2 words aligned, mean score 0.9, letters 1',
  ]);
  const quiet = recordedTakes({ kit: 'kit', takes, run: tools().run, env: { HF_HUB_OFFLINE: '0' } });
  assert.equal(quiet.synthesize([{ id: 'kb', text: 'Short one.' }], { work: path.join(dir, 'w2') }).length, 1, 'no log: nothing said, and work is made when absent');
});

test('the aligner\'s own setting of HF_HUB_OFFLINE is kept, and it runs in the kit, absolute paths only', () => {
  const was = process.cwd();
  process.chdir(dir);
  try {
    const takes = takesFolder({ 'One two.': ['a.wav', TAKE] }), { calls, run } = tools();
    recordedTakes({ kit: 'kits/voice', takes: 'takes', run, env: { HF_HUB_OFFLINE: '0' } }).synthesize([{ id: 'k1', text: 'One two.' }], { work: 'rel/work' });
    const python = calls.at(-1);
    assert.equal(python.opts.env.HF_HUB_OFFLINE, '0');
    assert.equal(python.opts.cwd, path.join(process.cwd(), 'kits', 'voice'));
    assert.equal(python.args.at(-1), path.join(process.cwd(), 'rel', 'work'));
    assert.equal(calls[0].args[calls[0].args.indexOf('-i') + 1], path.join(process.cwd(), 'takes', 'a.wav'));
    assert.ok(takes.endsWith(path.join('takes')));
  } finally {
    process.chdir(was);
  }
});

test('check: a take the aligner could not fit, timed short, or gave nothing back for is refused — every one at once', () => {
  const takes = takesFolder({ 'One two.': ['1.wav', TAKE], 'Three four.': ['3.wav', TAKE], 'Five six.': ['5.wav', TAKE], 'Fine line.': ['f.wav', TAKE] });
  const run = tools({ failed: { 'One two.': 'targets length is too long for CTC' }, short: ['Three four.'], lose: ['Five six.'] }).run;
  const engine = recordedTakes({ kit: dir, takes, run });
  const scenes = ['One two.', 'Three four.', 'Five six.', 'Fine line.'].map((text, i) => ({ id: `k${i}`, text }));
  assert.throws(() => engine.synthesize(scenes, { work: path.join(dir, 'w') }), { message: 'recordedTakes refused 3 take(s):\n'
    + '  1.wav ("One two."): the aligner could not fit its words to it (targets length is too long for CTC)\n'
    + '  3.wav ("Three four."): the aligner timed 1 of its 2 words\n'
    + '  5.wav ("Five six."): the aligner gave nothing back for it\n'
    + 'Is each the take of its line? Record it again, or point takes.json at the right file.' });
});

test('trim: a take with no sound is refused before the aligner runs — every one at once', () => {
  const takes = takesFolder({ 'Silent one.': ['s.wav', [[2, 0]]], 'Humming two.': ['h.wav', [[2, 0.001]]], 'Fine line.': ['f.wav', TAKE] }), { calls, run } = tools();
  const scenes = ['Silent one.', 'Humming two.', 'Fine line.'].map((text, i) => ({ id: `k${i}`, text }));
  assert.throws(() => recordedTakes({ kit: dir, takes, run }).synthesize(scenes, { work: path.join(dir, 'w') }), { message:
    'recordedTakes: no sound louder than -45 dB for 0.1 s in s.wav ("Silent one."), h.wav ("Humming two.") — record them again, or set trim.threshold lower' });
  assert.ok(calls.every((c) => c.cmd === 'ffmpeg'), 'the aligner never ran');
});

test('a tool that fails says which, why, and the fix: ffmpeg not installed, ffmpeg\'s own error, the aligner', () => {
  const takes = takesFolder({ 'One two.': ['a.wav', TAKE] }), scenes = [{ id: 'k1', text: 'One two.' }], work = path.join(dir, 'w');
  const missing = () => ({ status: null, error: new Error('spawnSync ffmpeg ENOENT') });
  assert.throws(() => recordedTakes({ kit: dir, takes, run: missing }).synthesize(scenes, { work }),
    { message: 'ffmpeg failed (spawnSync ffmpeg ENOENT) on the take a.wav: is ffmpeg installed (or passed as ffmpeg), and is the file a recording (WAV or M4A)?' });
  const broken = () => ({ status: 1, stderr: '[in#0] a.wav: one\nInvalid data found when processing input\n' });
  assert.throws(() => recordedTakes({ kit: dir, takes, run: broken }).synthesize(scenes, { work }), /^Error: ffmpeg failed \(exit 1: Invalid data found when processing input\) on the take a\.wav/);
  const seen = [], custom = (cmd, args) => { seen.push(cmd); return cmd === '/opt/ffmpeg' ? fakeFfmpeg(args) : { status: null, signal: 'SIGKILL' }; };
  assert.throws(() => recordedTakes({ kit: '/kit', takes, ffmpeg: '/opt/ffmpeg', python: 'py/bin/python', run: custom }).synthesize(scenes, { work }),
    { message: 'the take aligner failed (signal SIGKILL) with /kit/py/bin/python: it needs the kit\'s voice Python, with torch and torchaudio (the kit\'s setup-voice.sh), and the MMS_FA model on disk' });
  assert.deepEqual(seen, ['/opt/ffmpeg', '/opt/ffmpeg', '/kit/py/bin/python']);
});

test('the cache keeps recorded takes under their session, with their record — a cloned clip of the same text is another', async () => {
  const takes = takesFolder({ 'Hello world.': ['a.wav', TAKE] }), cache = path.join(dir, 'cache'), lines = [];
  const engine = recordedTakes({ kit: dir, takes, run: tools().run });
  assert.deepEqual(await voiceClips(['Hello world.', '', 'Hello world.'], { cache, profile: engine.profile, engine, log: (l) => lines.push(l) }), { wanted: 2, todo: 1, voiced: 1 });
  const clip = clipFor('Hello world.', { cache, profile: engine.profile });
  assert.equal(clip.key, clipKey('Hello world.', engine.profile));
  assert.equal(clip.duration, 3);
  assert.deepEqual(clip.sentences, [0]);
  assert.deepEqual(clip.take, { file: 'a.wav', trim: { length: 4.8, kept: 3, cutBefore: 0.3, cutAfter: 0.6, pauses: [{ at: 1.5, was: 1.5, now: 0.6 }] },
    check: { words: 2, meanScore: 0.9, lowWords: [], letterMatch: 1 } });
  assert.equal(readWav(clip.audio).samples.length, 48000);
  assert.equal(clipFor('Hello world.', { cache, profile: CLONED }), null, 'the cloned voice\'s key finds nothing');
  assert.equal(lines.at(-1), 'clips cached: 1/1');
});

test('the cache never crosses voices: a recorded engine with another profile, a recorded profile with another engine — refused before any work', async () => {
  const takes = takesFolder({ 'Hi there.': ['a.wav', TAKE] }), cache = path.join(dir, 'cache'), { calls, run } = tools();
  const engine = recordedTakes({ kit: dir, takes, run });
  await assert.rejects(voiceClips(['Hi there.'], { cache, profile: CLONED, engine }),
    { message: `the recorded engine makes clips for its own profile ("${engine.profile.id}") only, not "me": pass profile: engine.profile` });
  const kit = chatterboxKit({ kit: dir, run });
  await assert.rejects(voiceClips(['Hi there.'], { cache, profile: engine.profile, engine: kit }),
    { message: `"${engine.profile.id}" is a recorded session's profile: only the recordedTakes engine that made it fills it, not the chatterbox engine` });
  assert.equal(existsSync(cache), false);
  assert.equal(calls.length, 0);
  assert.equal((await voiceClips(['Hi there.'], { cache, profile: { ...engine.profile, note: 'a copy' }, engine })).voiced, 1, 'a copy of the profile is the same recipe');
});

test('the cache hands every scene to preflight before the first batch: every missing line in one refusal', async () => {
  const takes = takesFolder({ 'One.': ['1.wav', TAKE] }), { calls, run } = tools();
  const engine = recordedTakes({ kit: dir, takes, run });
  await assert.rejects(voiceClips(['One.', 'Two.', 'Three.', 'Four.'], { cache: path.join(dir, 'cache'), profile: engine.profile, engine, batch: 1 }),
    /^Error: recordedTakes: 3 lines have no take in .+\n  "Two\.": "<file>\.m4a",\n  "Three\.": "<file>\.m4a",\n  "Four\.": "<file>\.m4a"$/);
  assert.equal(calls.length, 0, 'nothing was cut or aligned');
  const asked = [];
  const careful = { name: 'careful', preflight: async (scenes) => { asked.push(scenes.map((s) => s.text)); }, synthesize: (scenes) => scenes.map(() => { throw new Error('not reached'); }) };
  await voiceClips(['A.', 'B.'], { cache: path.join(dir, 'cache'), profile: CLONED, engine: careful, only: new Set([5]) });
  assert.deepEqual(asked, [], 'nothing to voice: no preflight');
});

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

test('the real ffmpeg cuts exactly as planned — the stand-in above is ffmpeg\'s cut — and decodes an M4A take', { skip: !HAS_FFMPEG && 'ffmpeg is not installed' }, () => {
  const takes = takesFolder({ 'Hello world.': ['a.wav', TAKE] }), work = path.join(dir, 'real'), faked = path.join(dir, 'faked');
  const real = (cmd, args, opts) => (cmd === 'ffmpeg' ? spawnSync(cmd, args, opts) : { status: 0 });
  const found = [{ id: 'ka', text: 'Hello world.', file: 'a.wav', path: path.join(takes, 'a.wav') }];
  const [cut] = trimTakes(found, work, TRIM, { ffmpeg: 'ffmpeg', run: real });
  trimTakes(found, faked, TRIM, { ffmpeg: 'ffmpeg', run: (cmd, args) => fakeFfmpeg(args) });
  assert.deepEqual(cut.trim.kept, 3);
  assert.deepEqual(readWav(path.join(work, cut.audio)), readWav(path.join(faked, cut.audio)), 'sample for sample');
  const m4a = path.join(takes, 'a.m4a');
  assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(takes, 'a.wav'), '-c:a', 'aac', m4a]).status, 0);
  const [fromM4a] = trimTakes([{ ...found[0], file: 'a.m4a', path: m4a }], path.join(dir, 'm4a'), TRIM, { ffmpeg: 'ffmpeg', run: real });
  assert.ok(Math.abs(fromM4a.trim.kept - 3) < 0.05, `an M4A take is cut as its WAV is (kept ${fromM4a.trim.kept} s)`);
  trimTakes(found, path.join(dir, 'again'), TRIM, { ffmpeg: 'ffmpeg', run: real });
  assert.deepEqual(readFileSync(path.join(dir, 'again', cut.audio)), readFileSync(path.join(work, cut.audio)), 'the same take, the same bytes');
});
