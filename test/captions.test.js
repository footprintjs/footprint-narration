// captions/ — cues by sentence (StoryDeck 0.2.0's tests), chunks by word and the caption file (footprint-storyreel
// 0.9.0's formats.test.mjs and finished.test.mjs), and the differential properties against both controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import * as deck from './control/storydeck-0.2.0-narration.js';
import * as reel from './control/storyreel-0.9.0-captions.mjs';
import { readCaptions as reelRead } from './control/storyreel-0.9.0-readCaptions.mjs';
import { captionCues, captionChunks, captionAt, captionFile, readCaptions, stamp, FILE_CHUNKS, autoRules, spokenMap } from '../index.js';

const RUNS = Number(process.env.FC_RUNS) || 3000;
const text = (c) => c.words.map((w) => w.text).join(' ');

test('cues by sentence: each from its aligned start to the next (the last to the end of the clip)', () => {
  const clip = { duration: 6, sentences: [0.2, 2.5, 4] };
  assert.deepEqual(captionCues([{ start: 10, lead: 0.5, written: 'One. Two. Three.', spoken: 'One. Two. Three.', clip }]), [
    { start: 10.7, end: 13, text: 'One.' }, { start: 13, end: 14.5, text: 'Two.' }, { start: 14.5, end: 16.5, text: 'Three.' }]);
  const written = captionCues([{ start: 0, written: 'In 2000. The web. Done.', spoken: 'In two thousand. The web. Done.', clip }]);
  assert.deepEqual(written.map((c) => c.text), ['In 2000.', 'The web.', 'Done.'], 'as written when the sentences line up');
  const said = captionCues([{ start: 0, written: 'At 3.5 s. Then. Done.', spoken: 'At three. five s. Then. Done.', clip: { duration: 5, sentences: [0, 1, 2, 3] } }]);
  assert.deepEqual(said.map((c) => c.text), ['At three.', 'five s.', 'Then.', 'Done.'], 'else as spoken');
  assert.deepEqual(captionCues([{ start: 0, written: 'x', spoken: 'x', clip: null }, { start: 1, written: 'y', spoken: 'y' }]), []);
  assert.deepEqual(captionCues([{ start: 0, written: 'A. B. C.', spoken: 'A. B. C.', clip: { duration: 2, sentences: [0, 2] } }]).map((c) => c.text), ['A.']);
  const spoken = spokenMap('Done. ... Next.', { rules: autoRules() }).spoken;
  assert.deepEqual(captionCues([{ start: 0, written: 'Done. ... Next.', spoken, clip: { duration: 2, sentences: [0, 1] } }]).map((c) => c.text), ['Done. ...', 'Next.']);
});

// A film as tracks: a spoken scene's words on its own clock, at its offset (footprint-storyreel's evenTimings shape).
const track = (offset, narration) => {
  const words = narration.split(/\s+/).map((t, i) => ({ text: t, start: +(0.3 + i * 0.38).toFixed(3), end: +(0.3 + i * 0.38 + 0.342).toFixed(3) }));
  return { offset, duration: +(0.3 + words.length * 0.38 + 0.8).toFixed(3), words };
};
const talk = track(3.3, 'Two searches. Both find nothing, so what do they mean? Not always the same thing.');
const tracks = [talk, track(3.3 + talk.duration, 'Come to the talk to see how.')];

test('chunks: the spoken words in short chunks, broken after punctuation', () => {
  const chunks = captionChunks(tracks, { maxWords: 4 });
  assert.ok(chunks.every((c) => c.words.length <= 5), 'at most maxWords words a chunk (one more only to finish a clause)');
  assert.deepEqual(chunks.map(text), ['Two searches.', 'Both find nothing,', 'so what do they mean?', 'Not always the same thing.', 'Come to the talk', 'to see how.'],
    'a clause-ending word joins a full chunk instead of standing alone');
  assert.ok(chunks.every((c) => c.text === text(c)), 'a chunk\'s text is its words');
  chunks.forEach((c, i) => { if (chunks[i + 1]) assert.ok(c.end <= chunks[i + 1].start + 1e-9, 'chunks never overlap'); });
  assert.deepEqual(captionChunks(tracks, FILE_CHUNKS).map(text), ['Two searches.', 'Both find nothing, so what do they mean?', 'Not always the same thing.', 'Come to the talk to see how.']);
  assert.deepEqual(captionChunks(tracks, { maxWords: 20, maxChars: 20, breaks: 'sentence' }).map(text).slice(1, 3), ['Both find nothing,', 'so what do they'], 'maxChars closes a chunk before the word that would not fit');
  assert.throws(() => captionChunks(tracks, { maxWords: 0 }), /maxWords must be a whole number 1–20/);
  assert.throws(() => captionChunks(tracks, { maxChars: 5 }), /maxChars must be a whole number of at least 12/);
  assert.throws(() => captionChunks(tracks, { breaks: 'comma' }), /breaks must be 'clause' or 'sentence'/);
  assert.throws(() => captionChunks({}), /tracks must be a list/);
  assert.throws(() => captionChunks([{ offset: 0, words: [] }]), /tracks\[0\] must be \{ offset, duration, words \}/);
  assert.deepEqual(captionChunks([{ offset: 0, duration: 2, words: [{ text: '—', start: 0, end: 1 }] }]), [], 'a word with no letter or digit is never captioned');
});

test('chunks: the word being said is the active one; nothing between tracks', () => {
  const chunks = captionChunks(tracks), searches = talk.offset + talk.words[1].start;
  const c = captionAt(chunks, searches + 0.01);
  assert.equal(c.words[c.active].text, 'searches.');
  assert.equal(captionAt(chunks, 0.5), null);
  const last = chunks.at(-1);
  assert.equal(captionAt(chunks, last.words.at(-1).end + 0.4).active, -1, 'after the last word, while its chunk still shows: none active');
});

test('the caption file: WebVTT and SRT, numbered, on the video\'s clock, two lines at most', () => {
  const w = (t, start, end) => ({ text: t, start, end });
  const chunks = [{ start: 1, end: 2.5, words: [w('Two', 1, 1.4), w('searches.', 1.4, 2.1)] },
    { start: 2.5, end: 4.25, words: 'Both find nothing, so what do they mean, really, in the end?'.split(' ').map((t, i) => w(t, 2.5 + i * 0.1, 2.6 + i * 0.1)) }];
  assert.equal(captionFile(chunks, 'vtt'), 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nTwo searches.\n\n2\n00:00:02.500 --> 00:00:04.250\nBoth find nothing, so what do\nthey mean, really, in the end?\n');
  assert.equal(captionFile(chunks, 'srt', { offset: 3600 - 1 }), '1\n01:00:00,000 --> 01:00:01,500\nTwo searches.\n\n2\n01:00:01,500 --> 01:00:03,250\nBoth find nothing, so what do\nthey mean, really, in the end?\n');
  assert.equal(captionFile(chunks, 'srt', { from: 2, to: 3, offset: -2 }), '1\n00:00:00,000 --> 00:00:00,500\nTwo searches.\n\n2\n00:00:00,500 --> 00:00:01,000\nBoth find nothing, so what do\nthey mean, really, in the end?\n', 'a partial render keeps the cues it covers, cut at its edges');
  assert.throws(() => captionFile(chunks, 'ass'), /kind must be 'vtt' or 'srt'/);
  assert.throws(() => captionFile([{ start: 0, end: 1 }]), /a cue needs its text or its words/);
});

test('the caption file from sentence cues: SRT as StoryDeck wrote it; WebVTT now numbered', () => {
  const cues = [{ start: 0.5, end: 3661.25, text: 'Hello.' }, { start: 3662, end: 3663, text: 'Bye.' }];
  assert.equal(stamp(3661.25), '01:01:01,250');
  assert.equal(stamp(-2, '.'), '00:00:00.000');
  assert.equal(captionFile(cues, 'srt'), deck.toSrt(cues));
  assert.equal(captionFile(cues, 'vtt'), 'WEBVTT\n\n1\n00:00:00.500 --> 01:01:01.250\nHello.\n\n2\n01:01:02.000 --> 01:01:03.000\nBye.\n');
  assert.equal(captionFile([], 'vtt'), 'WEBVTT\n\n');
  assert.equal(captionFile([], 'srt'), '');
});

test('the caption file keeps a caption\'s words as words: no cue arrow inside, WebVTT\'s markup escaped, white space as one space', () => {
  const cues = [{ start: 0, end: 1, text: 'Keep the list < 10 items & mount <deck-stage> --> first.' }];
  assert.ok(captionFile(cues, 'vtt', { lineChars: Infinity }).includes('\nKeep the list &lt; 10 items &amp; mount &lt;deck-stage&gt; → first.\n'));
  assert.ok(captionFile(cues, 'srt', { lineChars: Infinity }).includes('\nKeep the list < 10 items & mount <deck-stage> → first.\n'));
  assert.ok(captionFile(cues, 'vtt').includes('\nKeep the list &lt; 10 items &amp;\nmount &lt;deck-stage&gt; → first.\n'), 'wrapped as seen, then escaped');
  assert.ok(captionFile([{ start: 0, end: 1, text: ' Two\n\nlines ' }], 'srt').includes('\nTwo lines\n'));
  assert.equal(captionFile([{ start: 0, end: 1, text: '  ' }, { start: 1, end: 1.02, text: 'sliver' }, { start: 2, end: 3, text: '\u00a0\u202f' }], 'srt'), '', 'no cue with nothing to show, and no sliver');
  const nbsp = 'A single frame lasts 16.67\u00a0ms, which is very short';
  assert.ok(captionFile([{ start: 0, end: 1, text: nbsp }], 'srt').includes('\nA single frame lasts\n16.67\u00a0ms, which is very short\n'), 'a no-break space keeps a number with its unit');
});

test('reading a caption file back: both formats, numbered or not, a cue\'s lines joined', () => {
  assert.deepEqual(readCaptions('WEBVTT\n\n00:01.500 --> 00:02.000 align:start\nHi there\n'), [{ start: 1.5, end: 2, text: 'Hi there' }]);
  assert.deepEqual(readCaptions('\uFEFFWEBVTT\r\n\r\n1\r\n00:00:01.000 --> 00:00:02.000\r\nA &amp; B &lt;3&nbsp;ms\r\n'), [{ start: 1, end: 2, text: 'A & B <3\u00a0ms' }]);
  assert.deepEqual(readCaptions('1\n00:00:01,000 --> 00:00:02,000\nA &amp; B\n'), [{ start: 1, end: 2, text: 'A &amp; B' }], 'SRT has no escapes: as written');
});

// The differential properties against footprint-storyreel 0.9.0: chunks, the file, the reader.
const wordText = fc.oneof(fc.constantFrom('Two', 'searches.', 'Both', 'nothing,', 'mean?', 'done.”', '(soon).', 'me?\'', 'tomorrow!"', '—', '–', 'a;', 'b:', '16.67 ms,', '60 Hz.', 'x', 'é'),
  fc.string({ minLength: 1, maxLength: 8 }).filter((s) => !/\s/.test(s)));
const timed = fc.array(fc.tuple(wordText, fc.double({ min: 0.05, max: 1, noNaN: true })), { maxLength: 30 }).map((xs) => {
  let at = 0.3;
  return xs.map(([t, d]) => { const w = { text: t, start: +at.toFixed(3), end: +(at + d * 0.9).toFixed(3) }; at += d; return w; });
});
const filmTracks = fc.array(fc.tuple(timed, fc.double({ min: 0, max: 3, noNaN: true })), { maxLength: 4 }).map((scenes) => {
  let offset = 0;
  return scenes.map(([words, gap]) => { const duration = +((words.at(-1)?.end ?? 0) + 0.8).toFixed(3), t = { offset, duration: +(duration + gap).toFixed(3), words }; offset += t.duration; return t; });
});
const filmOf = (ts) => ({ timings: { scenes: ts.map((t) => ({ duration: t.duration, words: t.words, alignment: { method: 'forced' } })) }, clock: { offsets: ts.map((t) => t.offset) } });
const options = fc.record({ maxWords: fc.integer({ min: 1, max: 20 }), maxChars: fc.oneof(fc.constant(Infinity), fc.integer({ min: 12, max: 90 })), breaks: fc.constantFrom('clause', 'sentence') });

test('chunks equal footprint-storyreel 0.9.0\'s, word for word and time for time', () => {
  fc.assert(fc.property(filmTracks, options, (ts, opts) => {
    const ours = captionChunks(ts, opts).map(({ start, end, words }) => ({ start, end, words }));
    assert.deepEqual(ours, reel.captionChunks(filmOf(ts), opts));
  }), { numRuns: RUNS });
});

const fileOptions = fc.record({ offset: fc.double({ min: -5, max: 5, noNaN: true }), from: fc.double({ min: 0, max: 10, noNaN: true }), to: fc.oneof(fc.constant(Infinity), fc.double({ min: 0, max: 30, noNaN: true })), lineChars: fc.integer({ min: 8, max: 60 }) });
const plain = (s) => !/-->|[&<>]/.test(s);

test('the caption file equals footprint-storyreel 0.9.0\'s, byte for byte, for every text it could write', () => {
  fc.assert(fc.property(filmTracks, fc.constantFrom('vtt', 'srt'), fileOptions, (ts, kind, opts) => {
    const chunks = reel.captionChunks(filmOf(ts), FILE_CHUNKS);
    fc.pre(chunks.every((c) => plain(text(c))));
    assert.equal(captionFile(chunks, kind, opts), reel.captionFile(chunks, kind, opts));
  }), { numRuns: RUNS });
});

test('a caption file reads back: every cue\'s times to the millisecond, its text as shown (lines joined)', () => {
  const cue = fc.tuple(fc.double({ min: 0, max: 4000, noNaN: true }), fc.double({ min: 0.06, max: 9, noNaN: true }),
    fc.array(fc.oneof(fc.constantFrom('a', 'b&c', '<x>', '-->', 'é', '“q”', '1,250'), fc.string({ minLength: 1, maxLength: 6 }).filter((s) => /^\S+$/.test(s))), { minLength: 1, maxLength: 12 }));
  fc.assert(fc.property(fc.array(cue, { maxLength: 6 }), fc.constantFrom('vtt', 'srt'), (raw, kind) => {
    const cues = raw.map(([start, d, ws]) => ({ start, end: start + d, text: ws.join(' ') }));
    const back = readCaptions(captionFile(cues, kind));
    assert.equal(back.length, cues.length);
    back.forEach((b, i) => {
      assert.ok(Math.abs(b.start - cues[i].start) <= 0.0005 + 1e-9 && Math.abs(b.end - cues[i].end) <= 0.0005 + 1e-9);
      assert.equal(b.text, cues[i].text.replace(/-->/g, '→'));
    });
    if (kind === 'srt') assert.deepEqual(back, reelRead(captionFile(cues, kind)), 'SRT reads as footprint-storyreel 0.9.0 read it');
  }), { numRuns: RUNS });
});
