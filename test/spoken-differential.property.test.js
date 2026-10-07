// The differential properties of spoken/: the package says what the code it replaced said. The CONTROLS are that
// code, copied and never edited (test/control/README.md). Where the package differs on purpose, the generator
// leaves the case out and the CHANGELOG names it: a number of a million and up is said as millions, and a rule's
// spoken text is final (a custom list never chains). FC_RUNS=200000 npm test runs a deep sweep.
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import * as deck from './control/storydeck-0.2.0-narration.js';
import * as reel from './control/storyreel-0.9.0-clock-slots.mjs';
import { autoRules, spokenMap, spokenOffset, shownWords, unsaidDigits, normSpeech, SPELL, SAY } from '../index.js';
import { digitWords } from '../src/spoken/digits.js';

const RUNS = Number(process.env.FC_RUNS) || 3000;
const AUTO = autoRules();
const MILLION = /\d{7}/;   // said as millions now (0.2.0 said "one thousand thousand")

// Notes the way a deck has them: words, numbers, symbols, dashes, emoji, attached punctuation, [draft] marks and
// white space of every kind — as whole tokens, and as characters thrown together.
const TOKENS = ['the', 'UI', 'API', 'APIs', 'LLM', 'HCI', 'MCP', 'GUI', 'xUI', 'UIs', 'éUI', 'é', '日本', 'UI’s', 'UI,', '(UI)', 'API.',
  '0', '7', '42', '2000', '999999', 'p95', 'p7', '1,250', '3.5', '-5', '+3', '2026-10-07', 'x5', '5x', '_5', 'P95', '٥', '½',
  '&', '+', '=', '<', '>', '×', '%', 'α', 'Δ', 'π', '&.', '%,', '=?', '<5', '>-2', 'Q&A',
  '—', '–', '-', '/', '...', '…', '--', '->', '=>', '*', '|', '·', '→', '😀', '🚀.', '🤔?', '—.', '...!', '?', '!',
  'Done.', 'Wait,', 'Why?', 'a-b', 'and/or', 'c...d', 'R&D', 'C++', 'it’s', '“done”', '[draft]', '[draft]x'];
const SPACE = fc.constantFrom(' ', ' ', ' ', '  ', '\n', '\t', ' ', ' \n ');
const tokenNote = fc.array(fc.tuple(fc.constantFrom(...TOKENS), SPACE), { maxLength: 24 }).map((xs) => xs.flat().join(''));
const charNote = fc.array(fc.constantFrom(...'aAeéUIPpxXz0123456789.,;:!?—–-/…*|&+=<>×%αΔπ😀🚀[]_\'’"() \n'.split(''), 'UI', 'API', '[draft]', ' '), { maxLength: 40 }).map((a) => a.join(''));
const notes = fc.array(fc.oneof(tokenNote, charNote), { minLength: 1, maxLength: 3 });

test('rules: what the voice says equals StoryDeck 0.2.0\'s narrationText, note for note', () => {
  fc.assert(fc.property(notes, (ns) => {
    fc.pre(!MILLION.test(deck.writtenText(ns)));   // ([draft] removal can join two runs of digits into one)
    assert.equal(spokenMap(deck.writtenText(ns), { rules: AUTO }).spoken, deck.narrationText(ns));
  }), { numRuns: RUNS });
});

// Custom lists in the domain both agree on: spell keys in upper case and values in lower case (so no value holds a
// key: 0.2.0 would have chained it), say keys symbols and Greek letters, values in words.
const upperWord = fc.array(fc.constantFrom(...'ABCDEFGHUIPQXYZ'), { minLength: 1, maxLength: 3 }).map((a) => a.join(''));
const lowerWord = fc.tuple(fc.constantFrom('', '(', '“', '-'), fc.array(fc.constantFrom(...'abcdefgijklmnoqrstuvwyzé'), { minLength: 1, maxLength: 5 }).map((a) => a.join('')),
  fc.constantFrom('', '', '’s', '-x', '.', ',', ';', ':', '?', '!', '…', ')', '”')).map((p) => p.join(''));
const lowerWords = fc.array(lowerWord, { minLength: 1, maxLength: 3 }).map((a) => a.join(' ')).filter((v) => !/[,;:]$/.test(v));   // a value may not end in , ; :
const spellList = fc.dictionary(upperWord, lowerWords, { maxKeys: 4 });
const sayList = fc.dictionary(fc.constantFrom('&', '+', '=', '<', '>', '×', '%', '#', '@', '~', '^', '==', '=>', '$', 'α', 'Δ', 'μ'), lowerWords, { maxKeys: 6 });
const listNote = fc.array(fc.tuple(fc.oneof(fc.constantFrom(...TOKENS), upperWord, fc.constantFrom('#', '@', '~', '^', '==', '$', '#.', 'AB.', '(XY)')), SPACE), { maxLength: 20 }).map((xs) => xs.flat().join(''));

test('rules: with a deck\'s own spell and say lists, too', () => {
  fc.assert(fc.property(fc.array(listNote, { minLength: 1, maxLength: 2 }), spellList, sayList, (ns, spell, say) => {
    fc.pre(!MILLION.test(deck.writtenText(ns)));
    assert.equal(spokenMap(deck.writtenText(ns), { rules: autoRules({ spell, say }) }).spoken, deck.narrationText(ns, { spell, say }));
  }), { numRuns: RUNS });
});

/** A map's laws: pieces join back to both texts; text pieces say what they show; norm offsets run on, contiguous, to both lengths. */
function lawful(map, text) {
  assert.equal(map.shown, text);
  assert.equal(map.pieces.map((p) => p.shown).join(''), map.shown);
  assert.equal(map.pieces.map((p) => p.spoken).join(''), map.spoken);
  for (const p of map.pieces) if (p.kind === 'text') assert.equal(p.shown, p.spoken);
  let n = 0, s = 0;
  for (const m of map.norm.map) {
    assert.ok(m.n0 === n && m.s0 === s && m.n1 >= m.n0 && m.s1 >= m.s0);
    n = m.n1; s = m.s1;
  }
  assert.equal(n, map.norm.shown.length);
  assert.equal(s, map.norm.spoken.length);
  assert.equal(map.norm.shown, map.pieces.map((p) => normSpeech(p.shown)).join(''));
}

test('the map\'s laws hold for any text, by rules', () => {
  fc.assert(fc.property(fc.oneof(tokenNote, charNote, fc.string({ unit: 'grapheme', maxLength: 30 })), (text) => lawful(spokenMap(text, { rules: AUTO }), text)), { numRuns: RUNS });
});

/** What the automatic rules say for a piece they made — a rule's spoken text is final: nothing after it (a pause included) changes it. */
const ruleSays = (shown) => SPELL[shown] ?? SAY[shown] ?? (/^p\d+$/.test(shown) ? `p ${digitWords(shown.slice(1))}` : digitWords(shown));
const anyText = fc.oneof(tokenNote, charNote, fc.string({ unit: 'grapheme', maxLength: 30 }));

test('every rule piece says exactly what its rule says: no later stage, and no pause, takes from it', () => {
  fc.assert(fc.property(anyText, (text) => {
    for (const p of spokenMap(text, { rules: AUTO }).pieces.filter((x) => x.kind === 'rule')) assert.equal(p.spoken, ruleSays(p.shown));
  }), { numRuns: RUNS });
});

/** Joined without white space: how an aligner that runs words together leaves them. */
const tight = (s) => s.replace(/\s+/g, '');
const runTogether = (words, every) => words.reduce((out, w, i) => { if (i && i % every === 0) out[out.length - 1] = { ...out.at(-1), text: `${out.at(-1).text}${w.text}`, end: w.end }; else out.push(w); return out; }, []);
const wordsOf = (text) => text.split(/\s+/).filter(Boolean).map((t, i) => ({ text: t, start: i, end: i + 0.9 }));

test('shownWords over the rules\' map shows the text as written — a pause as the mark it left — however the aligner splits the words', () => {
  fc.assert(fc.property(fc.oneof(tokenNote, charNote), fc.integer({ min: 1, max: 4 }), (note, every) => {
    const map = spokenMap(deck.writtenText([note]), { rules: AUTO });
    const shown = tight(map.pieces.map((p) => (p.kind === 'pause' ? p.spoken : p.shown)).join(''));
    for (const words of [wordsOf(map.spoken), runTogether(wordsOf(map.spoken), every + 1)]) assert.equal(tight(shownWords(map, words).map((w) => w.text).join('')), shown);
  }), { numRuns: RUNS });
});

// Narrations with number slots, the way a StoryReel storyboard has them: filler words around numbers with units.
const filler = fc.array(fc.constantFrom('One', 'frame', 'takes', 'at', 'the', 'screen', 'B2', '2012', '12', 'and', '(', ')', '"', ',', '.', '—', '-', 'x'), { maxLength: 4 }).map((a) => a.join(' '));
const shownNumber = fc.tuple(fc.integer({ min: 0, max: 99 }), fc.constantFrom('', '.67', '.5'), fc.constantFrom('', ' ms', ' Hz', '%', '-pebble'))
  .map(([n, d, u]) => `${n}${d}${u}`);
const spokenWords = fc.array(fc.constantFrom('sixteen', 'point', 'six', 'seven', 'milliseconds', 'sixty', 'hertz', 'two', 'twelve', 'percent'), { minLength: 1, maxLength: 4 }).map((a) => a.join(' '));
const slotted = fc.array(fc.tuple(filler, shownNumber, fc.boolean(), spokenWords), { minLength: 1, maxLength: 4 }).chain((parts) => fc.tuple(fc.constant(parts), filler)).map(([parts, tail]) => {
  const narration = parts.map(([f, shown]) => `${f} ${shown} `).join('') + tail;
  return { narration, say: parts.filter(([, , slot]) => slot).map(([, shown, , spoken]) => [shown, spoken]) };
});
const valid = ({ narration, say }) => { try { if (say.length) reel.checkSay({ narration, say }, 's'); return true; } catch { return false; } };
const merged = (words, every) => words.reduce((out, w, i) => { if (i && i % every === 0) out[out.length - 1] = { ...out.at(-1), text: `${out.at(-1).text}${w.text}`, end: w.end }; else out.push(w); return out; }, []);
const evenWords = (text) => text.split(/\s+/).filter(Boolean).map((t, i) => ({ text: t, start: +(0.3 + i * 0.38).toFixed(3), end: +(0.3 + i * 0.38 + 0.38 * 0.9).toFixed(3) }));

test('slots: what is said, the letters-and-digits map, the shown words and the unsaid digits equal footprint-storyreel 0.9.0\'s', () => {
  fc.assert(fc.property(slotted, fc.integer({ min: 2, max: 5 }), (scene, every) => {
    fc.pre(valid(scene));
    const map = spokenMap(scene.narration, { slots: scene.say });
    lawful(map, scene.narration);
    assert.equal(map.spoken, reel.spokenText(scene));
    const control = reel.slotMap(scene);
    if (control) { assert.equal(map.norm.shown, control.shown); assert.deepEqual(map.norm.map, control.map); }
    for (let at = 0; at <= map.norm.shown.length + 1; at++) for (const end of [false, true]) {
      assert.equal(spokenOffset(map, at, { end }), control ? reel.spokenOffset(control.map, at, end) : at <= map.norm.shown.length ? at : null);
    }
    for (const words of [evenWords(map.spoken), merged(evenWords(map.spoken), every)]) assert.deepEqual(shownWords(scene.say.length ? map : null, words), reel.shownWords(scene, words));
    assert.deepEqual(unsaidDigits(map), reel.unsaidNumbers({ scenes: [{ id: 's', ...scene }] }).map((u) => u.text));
  }), { numRuns: RUNS });
});

test('slots and rules together keep the map\'s laws, and every slot says what it says', () => {
  fc.assert(fc.property(slotted, (scene) => {
    fc.pre(valid(scene));
    const map = spokenMap(scene.narration, { slots: scene.say, rules: AUTO });
    lawful(map, scene.narration);
    assert.deepEqual(map.pieces.filter((p) => p.kind === 'slot').map((p) => [p.shown, p.spoken]), scene.say);
  }), { numRuns: RUNS });
});
