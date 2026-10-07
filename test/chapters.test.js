// chapters/ — YouTube's rule (footprint-storyreel 0.9.0's release.test.mjs pins, as `.lines`), the report StoryDeck
// 0.2.0's chapterList gave (now of what was fixed), the clock and its parser, and the properties.
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { youtubeChapters as reelChapters } from './control/storyreel-0.9.0-youtube.mjs';
import { clockText, readChapters, youtubeChapters } from '../index.js';

const RUNS = Number(process.env.FC_RUNS) || 3000;
const marks = (pairs) => pairs.map(([at, title]) => ({ at, title }));

test('a chapter\'s time as YouTube reads it, and the lines read back', () => {
  assert.equal(clockText(0), '0:00');
  assert.equal(clockText(95.9), '1:35');
  assert.equal(clockText(3725), '1:02:05');
  assert.deepEqual(readChapters('0:00 Intro\n2:30 Part 1\n\nnot a chapter\n1:02:05  Late  one \n62:05 As a long clock'), [
    { at: 0, title: 'Intro' }, { at: 150, title: 'Part 1' }, { at: 3725, title: 'Late  one' }, { at: 3725, title: 'As a long clock' }]);
});

test('footprint-storyreel 0.9.0\'s pins: an opening card under 10 s yields 0:00; a last chapter under 10 s is left out; two are not chapters', () => {
  assert.deepEqual(youtubeChapters(marks([[0, 'Open'], [4, 'Title'], [30, 'Middle'], [95, 'End']]), { length: 120 }).lines, ['0:00 Title', '0:30 Middle', '1:35 End']);
  assert.deepEqual(youtubeChapters(marks([[0, 'A'], [20, 'B'], [40, 'C'], [115, 'D']]), { length: 120 }).lines, ['0:00 A', '0:20 B', '0:40 C']);
  assert.deepEqual(youtubeChapters(marks([[0, 'A'], [20, 'B']]), { length: 60 }).lines, []);
});

test('in time order, the text to paste, and nothing to report when YouTube takes them as they are', () => {
  const list = youtubeChapters(marks([[150, 'Part 1'], [0, 'Intro'], [600, 'Part 2']]), { length: 900 });
  assert.equal(list.text, '0:00 Intro\n2:30 Part 1\n10:00 Part 2');
  assert.deepEqual(list.kept, marks([[0, 'Intro'], [150, 'Part 1'], [600, 'Part 2']]));
  assert.deepEqual([list.changes, list.problems], [[], []]);
});

test('says what it fixed — moved, replaced, merged, dropped — and what it could not', () => {
  const a = youtubeChapters(marks([[5, 'A'], [20, 'B']]));
  assert.deepEqual(a.changes, [{ kind: 'moved', title: 'A', at: 5, to: 0 }]);
  assert.deepEqual([a.lines, a.problems], [[], ['YouTube shows chapters only when there are at least three']]);
  const b = youtubeChapters(marks([[0, 'A'], [8, 'B'], [30, 'C']]), { length: 35 });
  assert.deepEqual(b.kept, marks([[0, 'B']]));
  assert.deepEqual(b.changes, [{ kind: 'replaced', title: 'A', at: 0, by: 'B' }, { kind: 'moved', title: 'B', at: 8, to: 0 }, { kind: 'dropped', title: 'C', at: 30 }]);
  const c = youtubeChapters(marks([[3, 'Card'], [6, 'Intro'], [40, 'One'], [45, 'Aside'], [80, 'Two'], [200, 'End']]), { length: 205 });
  assert.equal(c.text, '0:00 Intro\n0:40 One\n1:20 Two');
  assert.deepEqual(c.changes, [{ kind: 'replaced', title: 'Card', at: 3, by: 'Intro' }, { kind: 'moved', title: 'Intro', at: 6, to: 0 },
    { kind: 'merged', title: 'Aside', at: 45, into: 'One' }, { kind: 'dropped', title: 'End', at: 200 }]);
  const lone = youtubeChapters(marks([[4, 'Only']]), { length: 8 });
  assert.deepEqual([lone.kept, lone.changes], [[], [{ kind: 'dropped', title: 'Only', at: 4 }]], 'a moved mark that is then dropped is named once');
  assert.deepEqual(youtubeChapters([]).problems, ['YouTube shows chapters only when there are at least three']);
  assert.deepEqual(youtubeChapters(marks([[0, 'A'], [20, 'B'], [40, 'C'], [300, 'Late'], [600, 'Later']]), { length: 100 }).changes,
    [{ kind: 'dropped', title: 'Later', at: 600 }, { kind: 'dropped', title: 'Late', at: 300 }], 'a mark past the end is no chapter');
  assert.deepEqual(youtubeChapters(marks([[0, '  Two\nlines ']])).kept, [{ at: 0, title: 'Two lines' }], 'a title is one line');
});

test('refuses marks, a minimum or a length that are not times, naming the fix', () => {
  assert.throws(() => youtubeChapters('0:00 A'), /marks must be a list/);
  assert.throws(() => youtubeChapters([{ at: -1, title: 'A' }]), /marks\[0\] must be \{ at: seconds \(0 or more\), title: words \}/);
  assert.throws(() => youtubeChapters([{ at: 0, title: ' ' }]), /marks\[0\]/);
  assert.throws(() => youtubeChapters([], { min: 0 }), /min must be seconds, more than 0/);
  assert.throws(() => youtubeChapters([], { length: NaN }), /length must be the video's seconds/);
});

const title = fc.constantFrom('Intro', 'Part 1', 'Part 2', 'The middle', 'End', 'A', 'B', 'Q&A');
const timeline = fc.tuple(fc.array(fc.tuple(fc.integer({ min: 0, max: 600 }), title), { maxLength: 9 }), fc.integer({ min: 0, max: 700 }), fc.constantFrom(5, 10, 15));

test('the lines equal footprint-storyreel 0.9.0\'s (whose clock wrote an hour as 60:00)', () => {
  fc.assert(fc.property(timeline, ([pairs, length]) => {
    const sorted = pairs.filter(([at]) => at <= length).sort((x, y) => x[0] - y[0]);   // 0.9.0 dropped only one mark past the end
    assert.deepEqual(youtubeChapters(marks(sorted), { length }).lines, reelChapters(sorted, length));
  }), { numRuns: RUNS });
});

test('the rule\'s laws: first at 0:00, each at least min long, three or nothing, every mark accounted for once, and the text reads back', () => {
  fc.assert(fc.property(timeline, ([pairs, length, min]) => {
    const list = youtubeChapters(marks(pairs), { length, min });
    if (list.kept.length) assert.equal(list.kept[0].at, 0);
    list.kept.forEach((k, i) => { if (i) assert.ok(k.at - list.kept[i - 1].at >= min); });
    if (list.kept.length) assert.ok(length - list.kept.at(-1).at >= min);
    assert.ok(list.lines.length === 0 || (list.lines.length === list.kept.length && list.kept.length >= 3));
    // each mark's fate, by its title and its own time: kept where it was, kept but moved to 0:00, or named in a change
    const moved = list.changes.filter((c) => c.kind === 'moved');
    assert.ok(moved.length <= 1 && moved.every((c) => list.kept[0]?.title === c.title), 'only the first chapter is ever moved');
    const fates = [...list.kept.map((k, i) => (i === 0 && moved.length ? `${k.title}@${moved[0].at}` : `${k.title}@${k.at}`)),
      ...list.changes.filter((c) => c.kind !== 'moved').map((c) => `${c.title}@${c.at}`)].sort();
    assert.deepEqual(fates, pairs.map(([at, t]) => `${t}@${at}`).sort(), 'every mark is kept or named, once');
    if (list.lines.length) assert.deepEqual(readChapters(list.text), list.kept);
  }), { numRuns: RUNS });
});
