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
import { readTakeBook, findTakes, matchKey } from '../src/voice/takes.js';

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

/**
 * ffmpeg, stood in for: a decode copies (these takes are 16-bit mono PCM already); a cut keeps its filter's atrim
 * spans and adds its adelay and apad samples of silence.
 */
function fakeFfmpeg(args) {
  const input = args[args.indexOf('-i') + 1], out = args.at(-1);
  if (!args.includes('-filter_complex')) { copyFileSync(input, out); return { status: 0 }; }
  const { rate, samples } = readWav(input), graph = args[args.indexOf('-filter_complex') + 1];
  const keep = [...graph.matchAll(/start_sample=(\d+):end_sample=(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const pad = [/adelay=delays=(\d+)S/, /apad=pad_len=(\d+)/].map((re) => Number(graph.match(re)?.[1] ?? 0));
  writeFileSync(out, wavBytes(cutOf(samples, keep, pad), { rate }));
  return { status: 0 };
}

/** A cut, as samples: `pad[0]` zeros, the `keep` spans, `pad[1]` zeros. */
const cutOf = (samples, keep, pad) => [...new Array(pad[0]).fill(0), ...keep.flatMap(([a, b]) => [...samples.slice(a, b)]), ...new Array(pad[1]).fill(0)];

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
  assert.deepEqual(plan.pad, [0, 0]);
  assert.deepEqual(plan.trim, { length: 4.8, clip: 3, kept: 3, cutBefore: 0.3, cutAfter: 0.6, padBefore: 0, padAfter: 0, pauses: [{ at: 1.5, was: 1.5, now: 0.6 }] });
  assert.equal(cutFilter(plan.keep, plan.pad), '[0:a]atrim=start_sample=4800:end_sample=28800,asetpts=PTS-STARTPTS[p0];'
    + '[0:a]atrim=start_sample=43200:end_sample=67200,asetpts=PTS-STARTPTS[p1];[p0][p1]concat=n=2:v=0:a=1[out]');
  assert.deepEqual(planTrim(samplesOf(TAKE), RATE, TRIM), plan, 'the same take, the same cut');
  const loose = planTrim(samplesOf(TAKE), RATE, trimSettings({ lead: 0, tail: 0, maxPause: 2 }));
  assert.deepEqual([loose.keep, loose.pad], [[[8000, 60800]], [0, 0]], 'no lead, no tail, the pause kept whole');
});

test('trim maths: every clip gets exactly the lead and the tail — a take that starts or ends at once is padded with silence', () => {
  const sudden = planTrim(samplesOf([[1, 0.5], [0.1, 0]]), RATE, TRIM);
  assert.deepEqual([sudden.keep, sudden.pad], [[[0, 17600]], [3200, 4800]]);
  assert.deepEqual(sudden.trim, { length: 1.1, clip: 1.6, kept: 1.1, cutBefore: 0, cutAfter: 0, padBefore: 0.2, padAfter: 0.3, pauses: [] });
  assert.equal(cutFilter(sudden.keep, sudden.pad), '[0:a]atrim=start_sample=0:end_sample=17600,asetpts=PTS-STARTPTS[p0];[p0]concat=n=1:v=0:a=1,adelay=delays=3200S:all=1,apad=pad_len=4800[out]');
  const late = planTrim(samplesOf([[0.5, 0], [1, 0.5]]), RATE, TRIM);
  assert.deepEqual(late.pad, [0, 6400]);
  assert.equal(cutFilter(late.keep, late.pad), '[0:a]atrim=start_sample=4800:end_sample=24000,asetpts=PTS-STARTPTS[p0];[p0]concat=n=1:v=0:a=1,apad=pad_len=6400[out]');
  assert.equal(planTrim(samplesOf([[1, 0.5], [0.5, 0]]), RATE, TRIM).pad[1], 0, 'tail long enough: nothing added after');
  for (const take of [TAKE, [[1, 0.5]], [[0.05, 0], [0.4, 0.5], [2, 0], [0.4, 0.5]]]) {
    const samples = samplesOf(take), plan = planTrim(samples, RATE, TRIM), clip = cutOf(samples, plan.keep, plan.pad);
    const { loud, size } = loudWindows(clip, RATE, TRIM.threshold);
    assert.equal(loud.indexOf(true) * size, TRIM.lead * RATE, 'exactly the lead before the first sound');
    assert.equal(clip.length - (loud.lastIndexOf(true) + 1) * size, TRIM.tail * RATE, 'exactly the tail after the last');
    assert.equal(clip.length / RATE, plan.trim.clip);
  }
});

test('trim maths: a short lead stays whole, a pause under the cap is untouched, a short sound inside is never cut', () => {
  const near = planTrim(samplesOf([[0.1, 0], [0.5, 0.5], [0.4, 0], [0.5, 0.5], [0.2, 0]]), RATE, TRIM);
  assert.deepEqual([near.keep, near.pad], [[[0, 27200]], [1600, 3200]]);
  assert.deepEqual(near.trim, { length: 1.7, clip: 2, kept: 1.7, cutBefore: 0, cutAfter: 0, padBefore: 0.1, padAfter: 0.2, pauses: [] });
  const inner = planTrim(samplesOf([[0.3, 0], [0.5, 0.5], [1, 0], [0.05, 0.5], [1, 0], [0.5, 0.5], [0.3, 0]]), RATE, TRIM);
  assert.deepEqual(inner.trim.pauses, [{ at: 0.8, was: 1, now: 0.6 }, { at: 1.85, was: 1, now: 0.6 }], 'each side of the short sound is a pause of its own');
  assert.equal(inner.trim.kept, 2.75);
  assert.ok(inner.keep.some(([a, b]) => a <= 1.8 * RATE && b >= 1.85 * RATE), 'the 0.05 s sound is kept');
});

test('trim maths: a short word at either end is kept; a click farther than maxPause from the speech is cut', () => {
  const word = planTrim(samplesOf([[0.5, 0], [0.08, 0.5], [0.3, 0], [1, 0.5], [0.5, 0]]), RATE, TRIM);   // "A, …": 80 ms, a 0.3 s pause
  assert.equal(word.trim.cutBefore, 0.3, 'the 80 ms word starts the take');
  assert.ok(word.keep[0][0] <= 0.5 * RATE);
  assert.equal(planTrim(samplesOf([[0.5, 0], [0.08, 0.5], [0.3, 0], [0.08, 0.5], [0.3, 0], [1, 0.5], [0.5, 0]]), RATE, TRIM).trim.cutBefore, 0.3, 'two short words in a row');
  assert.equal(planTrim(samplesOf([[0.5, 0], [1, 0.5], [0.3, 0], [0.08, 0.5], [0.5, 0]]), RATE, TRIM).trim.cutAfter, 0.1, 'a short last word ("so.") ends the take');
  const click = planTrim(samplesOf([[0.5, 0], [0.03, 0.8], [1, 0], [1, 0.5], [0.5, 0]]), RATE, TRIM);
  assert.equal(click.trim.cutBefore, 1.33, 'a click 1 s before the first word is cut with the silence');
  assert.equal(planTrim(samplesOf([[0.5, 0], [1, 0.5], [1, 0], [0.03, 0.8], [0.5, 0]]), RATE, TRIM).trim.cutAfter, 1.13, 'and one 1 s after the last');
  assert.equal(planTrim(samplesOf([[0.5, 0], [0.03, 0.8], [1, 0], [1, 0.5], [0.5, 0]]), RATE, trimSettings({ minSound: 0 })).trim.cutBefore, 0.3, 'minSound 0: the click starts the take');
  assert.equal(planTrim(samplesOf([[0.5, 0], [0.08, 0.5], [0.5, 0]]), RATE, TRIM), null, 'one short sound alone: no speech for minSound');
  assert.equal(planTrim(samplesOf([[0.5, 0], [0.08, 0.5], [0.5, 0]]), RATE, trimSettings({ minSound: 0.05 })).trim.clip, 0.68, 'a one-word take, with minSound shorter');
});

test('trim maths: under the threshold is silence; a take with no sound has no cut; windows of 10 ms, the last one short', () => {
  const hum = samplesOf([[1, 0.001]]);   // about -63 dB
  assert.equal(planTrim(hum, RATE, TRIM), null);
  assert.equal(planTrim(samplesOf([[1, 0]]), RATE, TRIM), null);
  assert.deepEqual(planTrim(hum, RATE, trimSettings({ threshold: -70 })).trim.kept, 1, 'heard at -70 dB');
  assert.equal(planTrim(hum, RATE, trimSettings({ threshold: -70 })).trim.clip, 1.6, 'with the lead and tail added');
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

test('find: a line is matched word by word — "a part" is not "apart"', () => {
  assert.equal(matchKey('  Hello,   world!  '), 'hello world');
  assert.equal(matchKey('It’s “three” — now.'), 'its three now');
  assert.equal(matchKey('— …'), '');
  const takes = takesFolder({ 'A part.': ['1.wav', TAKE], 'Apart.': ['2.wav', TAKE] }), book = readTakeBook(takes);
  assert.deepEqual(findTakes([{ id: 'k1', text: 'a part' }, { id: 'k2', text: 'apart' }], book).map((t) => t.file), ['1.wav', '2.wav']);
  assert.equal(findTakes([{ id: 'k3', text: 'a-part' }], book)[0].file, '2.wav', 'a hyphen joins: one word');
  assert.throws(() => findTakes([{ id: 'k4', text: 'a parts' }], book), /1 line has no take/);
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

test('find: no take may be outside the takes folder or other than a file', () => {
  const takes = takesFolder({ 'One.': ['1.wav', TAKE] }), book = path.join(takes, 'takes.json'), open = () => recordedTakes({ kit: dir, takes, run: tools().run });
  writeFileSync(path.join(dir, 'outside.wav'), wavOf(TAKE));
  mkdirSync(path.join(takes, 'sub'));
  writeFileSync(path.join(takes, 'sub', 'deep.wav'), wavOf(TAKE));
  writeFileSync(book, JSON.stringify({ 'One.': '../outside.wav', 'Two.': path.join(dir, 'outside.wav'), 'Three.': 'sub/../../outside.wav' }));
  assert.throws(open, { message: `recordedTakes: takes.json names 3 files outside ${takes}: ../outside.wav, ${path.join(dir, 'outside.wav')}, sub/../../outside.wav — keep every take inside the takes folder` });
  writeFileSync(book, JSON.stringify({ 'One.': 'sub', 'Two.': '.' }));
  assert.throws(open, { message: 'recordedTakes: takes.json names 2 paths that are not files: sub, . — name each line\'s recording' });
  writeFileSync(book, JSON.stringify({ 'One.': 'sub/deep.wav', 'Two.': '..take.wav' }));
  assert.throws(open, /names 1 recording that .+ does not have: \.\.take\.wav/, 'a name that starts with two dots is inside');
  writeFileSync(path.join(takes, '..take.wav'), wavOf(TAKE));
  assert.equal(open().name, 'recorded', 'a take in a folder inside the takes folder');
});

test('a work folder over the takes is refused: it is emptied before each batch', async () => {
  const takes = takesFolder({ 'One two.': ['1.wav', TAKE] }), { calls, run } = tools(), engine = recordedTakes({ kit: dir, takes, run });
  const scenes = [{ id: 'k1', text: 'One two.' }], said = (work, how) => `recordedTakes: the work folder ${work} ${how} the takes folder ${takes}, and a work folder is emptied before each batch — give work a folder of its own, or leave it out`;
  assert.throws(() => engine.preflight(scenes, { work: takes }), { message: said(takes, 'is') });
  assert.throws(() => engine.preflight(scenes, { work: dir }), { message: said(dir, 'holds') });
  assert.throws(() => engine.synthesize(scenes, { work: path.join(takes, 'w') }), { message: said(path.join(takes, 'w'), 'is inside') });
  await assert.rejects(voiceClips(['One two.'], { cache: path.join(dir, 'cache'), profile: engine.profile, engine, work: takes }), { message: said(takes, 'is') });
  assert.ok(existsSync(path.join(takes, '1.wav')) && existsSync(path.join(takes, 'takes.json')), 'the takes are untouched');
  assert.equal(calls.length, 0);
  assert.doesNotThrow(() => engine.preflight(scenes, { work: path.join(dir, 'takes-work') }), 'a folder beside the takes');
  assert.doesNotThrow(() => engine.preflight(scenes), 'no work folder: a temporary one');
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
    ['ffmpeg', cutArgs(path.join(work, 'decoded', 'ka.wav'), { keep: keepA, pad: [0, 0] }, path.join(work, 'audio', 'ka.wav'))],
    ['ffmpeg', decodeArgs(path.join(takes, 'b.m4a'), path.join(work, 'decoded', 'kb.wav'))],
    ['ffmpeg', cutArgs(path.join(work, 'decoded', 'kb.wav'), { keep: [[0, 22400]], pad: [1600, 1600] }, path.join(work, 'audio', 'kb.wav'))],
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
    take: { file: 'a.wav', trim: { length: 4.8, clip: 3, kept: 3, cutBefore: 0.3, cutAfter: 0.6, padBefore: 0, padAfter: 0, pauses: [{ at: 1.5, was: 1.5, now: 0.6 }] },
      check: { words: 2, meanScore: 0.9, lowWords: [['world.', 0.21]], letterMatch: 1 } } });
  assert.equal(readWav(results[1].audio).samples.length, 25600, 'the short take, with its lead and tail made whole: 1.6 s');
  assert.deepEqual(lines, [
    'take a.wav: 4.80 s → 3.00 s (cut 0.30 s before, 0.60 s after; pauses capped to 0.60 s: 1.50 s at 1.50 s) · 2 words aligned, mean score 0.9, letters 1 · LOW, listen: "world." 0.21',
    'take b.m4a: 1.40 s → 1.60 s (cut 0.00 s before, 0.00 s after; silence added 0.10 s before, 0.10 s after) · 2 words aligned, mean score 0.9, letters 1',
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
    const own = tools();
    recordedTakes({ kit: 'kits/voice', takes: 'takes', python: '/opt/voice/bin/python', run: own.run }).synthesize([{ id: 'k1', text: 'One two.' }], { work: 'rel/work2' });
    assert.equal(own.calls.at(-1).cmd, '/opt/voice/bin/python', 'a Python given whole is not put under the kit');
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
    'recordedTakes: no sound louder than -45 dB for 0.1 s in s.wav ("Silent one."), h.wav ("Humming two.") — record them again, or set trim.threshold lower (or trim.minSound shorter, for a take of one short word)' });
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
  assert.deepEqual(clip.take, { file: 'a.wav', trim: { length: 4.8, clip: 3, kept: 3, cutBefore: 0.3, cutAfter: 0.6, padBefore: 0, padAfter: 0, pauses: [{ at: 1.5, was: 1.5, now: 0.6 }] },
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

test('the cache stays as it was for every other caller: no engine when all is cached, an engine with a profile field of its own', async () => {
  const cache = path.join(dir, 'cache'), takes = takesFolder({ 'Hi there.': ['a.wav', TAKE] }), recorded = recordedTakes({ kit: dir, takes, run: tools().run });
  await voiceClips(['Hi there.'], { cache, profile: recorded.profile, engine: recorded });
  assert.deepEqual(await voiceClips(['Hi there.'], { cache, profile: recorded.profile }), { wanted: 1, todo: 0, voiced: 0 }, 'a reader with no engine: all cached');
  const cloud = { name: 'cloud', profile: { id: 'a cloud voice', region: 'eu' }, synthesize: (scenes, { work }) => scenes.map((sc) => {
    const audio = path.join(work, `${sc.id}.wav`);
    writeFileSync(audio, 'x');
    return { id: sc.id, audio, duration: 1 };
  }) };
  assert.deepEqual(await voiceClips(['Hi there.'], { cache, profile: CLONED, engine: cloud }), { wanted: 1, todo: 1, voiced: 1 }, 'its own profile field is its business');
  assert.deepEqual(await voiceClips(['Hi there.'], { cache, profile: CLONED }), { wanted: 1, todo: 0, voiced: 0 });
  await assert.rejects(voiceClips(['Not voiced.'], { cache, profile: CLONED }), TypeError, 'no engine and a text to voice: as before');
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

// On CI the workflow installs ffmpeg, so this test must run there: it fails rather than skips.
test('the real ffmpeg cuts exactly as planned — the stand-in above is ffmpeg\'s cut, padding and all — and decodes an M4A take', { skip: !HAS_FFMPEG && !process.env.CI && 'ffmpeg is not installed' }, () => {
  assert.ok(HAS_FFMPEG, 'ffmpeg is not installed on CI: the workflow must install it (apt-get install -y ffmpeg)');
  const takes = takesFolder({ 'Hello world.': ['a.wav', TAKE], 'At once.': ['b.wav', [[1, 0.5], [0.1, 0]]] }), work = path.join(dir, 'real'), faked = path.join(dir, 'faked');
  const real = (cmd, args, opts) => (cmd === 'ffmpeg' ? spawnSync(cmd, args, opts) : { status: 0 });
  const found = [{ id: 'ka', text: 'Hello world.', file: 'a.wav', path: path.join(takes, 'a.wav') }, { id: 'kb', text: 'At once.', file: 'b.wav', path: path.join(takes, 'b.wav') }];
  const [cut, padded] = trimTakes(found, work, TRIM, { ffmpeg: 'ffmpeg', run: real });
  trimTakes(found, faked, TRIM, { ffmpeg: 'ffmpeg', run: (cmd, args) => fakeFfmpeg(args) });
  assert.deepEqual(cut.trim.kept, 3);
  assert.deepEqual(readWav(path.join(work, cut.audio)), readWav(path.join(faked, cut.audio)), 'sample for sample');
  assert.deepEqual([padded.trim.padBefore, padded.trim.padAfter, padded.trim.clip], [0.2, 0.3, 1.6]);
  assert.deepEqual(readWav(path.join(work, padded.audio)), readWav(path.join(faked, padded.audio)), 'the padding too, sample for sample');
  const m4a = path.join(takes, 'a.m4a');
  assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(takes, 'a.wav'), '-c:a', 'aac', m4a]).status, 0);
  const [fromM4a] = trimTakes([{ ...found[0], file: 'a.m4a', path: m4a }], path.join(dir, 'm4a'), TRIM, { ffmpeg: 'ffmpeg', run: real });
  assert.ok(Math.abs(fromM4a.trim.kept - 3) < 0.05, `an M4A take is cut as its WAV is (kept ${fromM4a.trim.kept} s)`);
  trimTakes(found, path.join(dir, 'again'), TRIM, { ffmpeg: 'ffmpeg', run: real });
  assert.deepEqual(readFileSync(path.join(dir, 'again', cut.audio)), readFileSync(path.join(work, cut.audio)), 'the same take, the same bytes');
});

// Opt-in: NARRATION_KIT=<a voice kit with .venv-voice and the MMS_FA weights> runs the real aligner. CI does not set it.
const KIT = process.env.NARRATION_KIT;

test('the real aligner: a take that says nothing aligns with every word low; one too short for its words is refused', { skip: !KIT && 'set NARRATION_KIT to a voice kit to run the real aligner' }, () => {
  const tone = 'Hello there, world.', crowded = 'This line has far too many words to fit into so short a take of sound.';
  const takes = takesFolder({ [tone]: ['tone.wav', [[0.5, 0], [2, 0.4], [0.5, 0]]], [crowded]: ['short.wav', [[0.05, 0.4]]] });
  const engine = recordedTakes({ kit: KIT, takes, trim: { minSound: 0.03 } });
  assert.throws(() => engine.synthesize([{ id: 'k1', text: tone }, { id: 'k2', text: crowded }], { work: path.join(dir, 'w1') }),
    /recordedTakes refused 1 take\(s\):\n {2}short\.wav \("This line.+"\): the aligner could not fit its words to it/);
  const [heard] = engine.synthesize([{ id: 'k1', text: tone }], { work: path.join(dir, 'w2') });
  assert.equal(heard.duration, 2.6, 'the lead, the tone, the tail');
  assert.deepEqual(heard.words.map((x) => x.text), ['Hello', 'there,', 'world.']);
  assert.ok(heard.words.every((x) => x.start >= 0 && x.end <= heard.duration));
  assert.equal(heard.take.check.lowWords.length, 3, 'a tone says none of its words');
  assert.ok(heard.take.check.letterMatch < 0.5);
  const timings = JSON.parse(readFileSync(path.join(dir, 'w2', 'timings.json'), 'utf8'));
  assert.deepEqual([timings.schemaVersion, timings.provider, timings.voiceProfile, timings.scenes[0].alignment.method], [1, 'recorded', engine.profile.id, 'forced-alignment-mms']);
});
