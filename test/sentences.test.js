// sentences/ — as a voice script splits them, and where each starts in a clip (from StoryDeck 0.2.0's tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { sentences, saidSentences, sentenceStarts, normSpeech } from '../index.js';

test('splits sentences as the voice script does', () => {
  assert.deepEqual(sentences('One. Two? Three! four'), ['One.', 'Two?', 'Three!', 'four']);
  assert.deepEqual(sentences('  '), []);
  assert.deepEqual(sentences(undefined), []);
  assert.deepEqual(sentences('Version 3.5 is out. Yes.'), ['Version 3.5 is out.', 'Yes.'], 'a stop not followed by a space ends nothing');
});

test('a written sentence the voice never says (a lone "...") joins its neighbour', () => {
  assert.deepEqual(saidSentences('... which brings us to part two.'), ['... which brings us to part two.']);
  assert.deepEqual(saidSentences('Done. ... Next.'), ['Done. ...', 'Next.']);
  assert.deepEqual(saidSentences('...'), []);
});

test('each sentence starts at its first word\'s aligned start; a word the aligner lost starts at 0', () => {
  const words = [{ start: 0.1 }, { start: 0.4 }, { start: 1.2 }, { start: 1.9 }, { start: 2.4 }];
  assert.deepEqual(sentenceStarts('Two words. Then three more!', words), [0.1, 1.2]);
  assert.deepEqual(sentenceStarts('One. Two.', [{ start: 0.2 }]), [0.2, 0]);
});

test('said sentences are never more than sentences, and both keep every letter and digit', () => {
  const text = fc.array(fc.constantFrom('One', 'two', '3.5', '...', '…', '—', '.', '?', '!', 'Done.', 'Why?', 'ok!', 'é', ' ', ' ', '  ', '\n'), { maxLength: 30 }).map((a) => a.join(' '));
  fc.assert(fc.property(text, (t) => {
    const all = sentences(t), said = saidSentences(t);
    assert.ok(said.length <= all.length);
    assert.equal(normSpeech(all.join(' ')), normSpeech(t));
    assert.equal(normSpeech(said.join(' ')), normSpeech(t));
  }), { numRuns: Number(process.env.FC_RUNS) || 3000 });
});
