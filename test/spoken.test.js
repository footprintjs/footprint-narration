// spoken/ — one text as shown and as spoken. The goldens are carried over verbatim from the code this replaced:
// StoryDeck 0.2.0's narration.test.js ("what the voice says") and footprint-storyreel 0.9.0's say.test.mjs and
// scripts.test.mjs (normSpeech).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normSpeech, numberWords, SPELL, SAY, autoRules, findSlot, checkSlots, spokenMap, spokenOffset, unsaidDigits, shownWords, sentences } from '../index.js';

const AUTO = autoRules();
/** What the voice says for a written note, by the automatic rules (StoryDeck's narrationText, minus [draft]). */
const say = (text, lists) => spokenMap(text.replace(/\s+/g, ' ').trim(), { rules: lists ? autoRules(lists) : AUTO }).spoken;
/** Timed words as footprint-storyreel's evenTimings makes them: 0.38 s a word, from 0.3 s. */
const evenWords = (text) => text.split(/\s+/).filter(Boolean).map((t, i) => ({ text: t, start: +(0.3 + i * 0.38).toFixed(3), end: +(0.3 + i * 0.38 + 0.38 * 0.9).toFixed(3) }));
/** The words a caption shows for a map, over even word times. */
const capt = (map) => shownWords(map, evenWords(map.spoken)).map((w) => w.text).join(' ');

test('normSpeech: a vowel sign is part of the word; English as before; a composed and a decomposed é are the same', () => {
  assert.equal(normSpeech('கடை!'), 'கடை');
  assert.notEqual(normSpeech('கடை'), normSpeech('கட'));
  assert.equal(normSpeech("Amaira's crayon, too!"), 'amairascrayontoo');
  assert.equal(normSpeech('café'), normSpeech('café'));
});

test('numbers in words, a million as a million, and digits past what a number is said as', () => {
  assert.deepEqual([0, 7, 19, 20, 42, 100, 101, 999, 1000, 2026, 12345].map(numberWords), [
    'zero', 'seven', 'nineteen', 'twenty', 'forty-two', 'one hundred', 'one hundred one', 'nine hundred ninety-nine',
    'one thousand', 'two thousand twenty-six', 'twelve thousand three hundred forty-five']);
  assert.equal(numberWords(1_000_000), 'one million');
  assert.equal(numberWords(2_500_000_017), 'two billion five hundred million seventeen');
  assert.equal(numberWords(999_999_999_999_999), 'nine hundred ninety-nine trillion nine hundred ninety-nine billion nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine');
  for (const bad of [-1, 1.5, NaN, 1e15, '7']) assert.throws(() => numberWords(bad), RangeError);
  assert.equal(say('Call 1234567890123456 now.'), 'Call one two three four five six seven eight nine zero one two three four five six now.', 'past fifteen digits: digit by digit');
  assert.equal(say('Call 0000000000000001 now.'), 'Call one now.', 'a zero-padded number is still a number');
  assert.equal(say('9'.repeat(400)).split(' ').length, 400, 'no overflow, however long');
});

test('rules: spells the words a voice misreads as a word (UI, API, APIs) and leaves every other acronym as written', () => {
  assert.equal(say('To give the agent a ledger in the UI, we first need to see how the UI works today.'), 'To give the agent a ledger in the U I, we first need to see how the U I works today.');
  assert.equal(say('MCP is a direct API connection; APIs differ.'), 'MCP is a direct A P I connection; A P Is differ.');
  assert.equal(say('Now put an LLM in your place, with HCI and MCP.'), 'Now put an LLM in your place, with HCI and MCP.');
  assert.equal(say('UIs and GUI stay; xUI too.'), 'UIs and GUI stay; xUI too.');
  assert.ok(Object.isFrozen(SPELL));
});

test('rules: a deck tunes its own spelling list (word edges, not \\b; regex characters escaped)', () => {
  assert.equal(say('An LLM and a UI.', { spell: { LLM: 'L L M' } }), 'An L L M and a UI.');
  assert.equal(say('A C++ build.', { spell: { 'C++': 'C plus plus' } }), 'A C plus plus build.');
  assert.equal(say('An a.b case.', { spell: { 'a.b': 'A B' } }), 'An A B case.');
});

test('rules: numbers as words, p-numbers as "p" and a number; a thousands comma reads as two numbers', () => {
  assert.equal(say('from about 2000 to today, 15 → 3 calls'), 'from about two thousand to today, fifteen, three calls');
  assert.equal(say('p95 latency over 1,250 ms'), 'p ninety-five latency over one,two hundred fifty ms');
});

test('rules: no word without a letter — a lone & or + is said, a lone - / ... … is a pause', () => {
  assert.equal(say('The web - then apps / tools ... and R&D + Q & A … done.'), 'The web, then apps, tools... and R&D plus Q and A, done.');
  assert.equal(say('& then +'), 'and then plus');
  assert.equal(say('a-b and/or c...d'), 'a-b and/or c...d');
  assert.equal(say('- a bullet'), 'a bullet');
  assert.equal(say('And then ...'), 'And then...');
  assert.equal(say('Next →'), 'Next,');
  assert.equal(say('a -- b -> c => d'), 'a, b, c, d');
  assert.equal(say('x = y * z | w % 😀 done.'), 'x equals y, z, w percent, done.');
  assert.equal(say('Done. — Then'), 'Done. Then');
  assert.equal(say('  '), '');
});

test('rules: a sentence end a dropped word carried stays, so the voice and the captions still end the sentence there', () => {
  assert.equal(say('Ship it 🚀. Then we rest.'), 'Ship it. Then we rest.');
  assert.equal(say('Why? — Because.'), 'Why? Because.');
  assert.equal(say('Wait, 🤔? Yes.'), 'Wait? Yes.');
  assert.equal(sentences(say('Ship it 🚀. Then we rest.')).length, sentences('Ship it 🚀. Then we rest.').length);
});

test('rules: a lone symbol that means something is said, and the Greek letters people write; a list can change', () => {
  assert.equal(say('Errors fell 90 %. Then we shipped the fix.'), 'Errors fell ninety percent. Then we shipped the fix.');
  assert.equal(say('Keep latency < 10 ms, not > 20.'), 'Keep latency less than ten ms, not more than twenty.');
  assert.equal(say('Set x = 3 first; it costs 3 × less.'), 'Set x equals three first; it costs three times less.');
  assert.equal(say('Pass a λ function; Δ is small, π is not.'), 'Pass a lambda function; delta is small, pi is not.');
  assert.equal(say('x = 1', { say: { '=': 'is' } }), 'x is one');
  assert.equal(say('x = 1', { say: {} }), 'x, one');
  assert.ok(Object.isFrozen(SAY));
});

test('rules: < and > are a comparison only before a number — a menu path\'s arrow is a pause', () => {
  assert.equal(say('Open File > Save As.'), 'Open File, Save As.');
  assert.equal(say('Go to Settings > Privacy > Cookies.'), 'Go to Settings, Privacy, Cookies.');
  assert.equal(say('Keep it > 20 ms, and < 5 % lost.'), 'Keep it more than twenty ms, and less than five percent lost.');
});

test('rules: spelled at Unicode word edges, so a word in another script gets the reading given', () => {
  assert.equal(say('日本 rocks; the UI’s look', { spell: { ...SPELL, 日本: 'Japan' } }), 'Japan rocks; the U I’s look');
  assert.equal(say('éUI stays', {}), 'éUI stays');
});

test('rules: what a rule says is final — no later spell entry or rule reads it again', () => {
  assert.equal(say('A then B.', { spell: { A: 'bee', B: 'see' } }), 'bee then see.');
  assert.equal(say('A.', { spell: { A: 'B', B: 'C' } }), 'B.', 'StoryDeck 0.2.0 chained A → B → C');
  assert.equal(say('Use alpha.', { spell: { alpha: 'α' } }), 'Use α.', '0.2.0 then said the α as "alpha"');
});

test('rules: a list that cannot be said is refused, naming the fix; white space in a value is one space', () => {
  assert.throws(() => autoRules({ spell: ['UI'] }), /spell must be an object of what is written → how it is said/);
  assert.throws(() => autoRules({ say: null }), /say must be an object/);
  assert.throws(() => autoRules({ spell: { '': 'x' } }), /a spell key must be one word/);
  assert.throws(() => autoRules({ spell: { 'New York': 'N Y' } }), /a spell key must be one word \(not empty, no white space\), not "New York"/);
  assert.throws(() => autoRules({ spell: { Win: 'Windows 11' } }), /spell\["Win"\] must be what the voice says, in words — a letter in every word, no digits, and no comma, semicolon or colon at its end — not "Windows 11"/);
  assert.throws(() => autoRules({ spell: { UI: 'U I,' } }), /no comma, semicolon or colon at its end/, 'a pause after it could not take the mark back');
  assert.equal(autoRules({ spell: { UI: 'U, I.' } }).spell.UI, 'U, I.', 'a mark inside, or a stop at the end, is fine');
  assert.throws(() => autoRules({ spell: { 'R&D': 'R & D' } }), /a letter in every word/);
  assert.throws(() => autoRules({ say: { '&': '' } }), /say\["&"\]/);
  assert.throws(() => autoRules({ say: { '&': 7 } }), /not 7/);
  const tuned = autoRules({ spell: { UI: '  U \n I ' } });
  assert.equal(tuned.spell.UI, 'U I');
  assert.ok(Object.isFrozen(tuned) && Object.isFrozen(tuned.spell) && Object.isFrozen(tuned.say));
  assert.equal(tuned.name, 'auto');
});

test('the map: pieces join back to both texts; each says what kind it is', () => {
  const map = spokenMap('Wait, 🤔? The UI has 3 tabs.', { rules: AUTO });
  assert.equal(map.shown, 'Wait, 🤔? The UI has 3 tabs.');
  assert.equal(map.spoken, 'Wait? The U I has three tabs.');
  assert.deepEqual(map.pieces, [
    { shown: 'Wait', spoken: 'Wait', kind: 'text' }, { shown: ', 🤔?', spoken: '?', kind: 'pause' },
    { shown: ' The ', spoken: ' The ', kind: 'text' }, { shown: 'UI', spoken: 'U I', kind: 'rule' },
    { shown: ' has ', spoken: ' has ', kind: 'text' }, { shown: '3', spoken: 'three', kind: 'rule' }, { shown: ' tabs.', spoken: ' tabs.', kind: 'text' }]);
  assert.equal(map.pieces.map((p) => p.shown).join(''), map.shown);
  assert.equal(map.pieces.map((p) => p.spoken).join(''), map.spoken);
  assert.deepEqual(map.norm.map.find((m) => m.slot === '3'), { n0: 12, n1: 13, s0: 12, s1: 17, slot: '3' });
  assert.deepEqual(spokenMap('Plain words.'), { shown: 'Plain words.', spoken: 'Plain words.', pieces: [{ shown: 'Plain words.', spoken: 'Plain words.', kind: 'text' }],
    norm: { shown: 'plainwords', spoken: 'plainwords', map: [{ n0: 0, n1: 10, s0: 0, s1: 10, slot: null }] } });
  assert.throws(() => spokenMap(null), /text must be a string, not null/);
  assert.throws(() => spokenMap(7), /not number/);
  assert.throws(() => spokenMap('x', { rules: {} }), /rules must be a strategy/);
  assert.throws(() => spokenMap('x', { rules: { name: 'liar', apply: () => [{ shown: 'y', spoken: 'y', kind: 'text' }] } }), /the rules "liar" changed the text as shown/);
});

// footprint-storyreel 0.9.0's say.test.mjs, its pure cases: a scene's narration and its `say` slots.
const frame = ['One frame takes 16.67 ms, at 60 Hz.', [['16.67 ms', 'sixteen point six seven milliseconds'], ['60 Hz', 'sixty hertz']]];

test('slots: the voice says the spoken words; the shown words collapse each spoken run back into its digits', () => {
  const map = spokenMap(frame[0], { slots: frame[1] });
  assert.equal(map.spoken, 'One frame takes sixteen point six seven milliseconds, at sixty hertz.');
  assert.deepEqual(evenWords(map.spoken).map((w) => w.text).slice(3, 8), ['sixteen', 'point', 'six', 'seven', 'milliseconds,']);
  const words = evenWords(map.spoken), shown = shownWords(map, words);
  assert.deepEqual(shown.map((w) => w.text), ['One', 'frame', 'takes', '16.67 ms,', 'at', '60 Hz.']);
  assert.equal(shown[3].start, words[3].start);
  assert.equal(shown[3].end, words[7].end);
  assert.equal(spokenMap('No slots here.', { slots: [] }).spoken, 'No slots here.');
});

test('slots: a phrase written as shown finds the words said; part of a slot covers all of it', () => {
  const map = spokenMap(frame[0], { slots: frame[1] });
  const span = (phrase) => { const at = map.norm.shown.indexOf(normSpeech(phrase)); return [spokenOffset(map, at), spokenOffset(map, at + normSpeech(phrase).length, { end: true })]; };
  const said = (phrase) => { const at = map.norm.spoken.indexOf(normSpeech(phrase)); return [at, at + normSpeech(phrase).length]; };
  assert.deepEqual(span('takes 16.67 ms'), said('takes sixteen point six seven milliseconds'));
  assert.deepEqual(span('at 60 Hz'), said('at sixty hertz'));
  assert.deepEqual(span('takes 16.67'), said('takes sixteen point six seven milliseconds'), 'the slot\'s whole run');
  const inside = map.norm.shown.indexOf('takes16') + 'takes16'.length;
  assert.equal(spokenOffset(map, inside), said('takes')[1], 'an offset inside a slot: its start, or with end its end');
  assert.equal(spokenOffset(map, inside, { end: true }), said('takes sixteen point six seven milliseconds')[1]);
  assert.equal(spokenOffset(map, map.norm.shown.length + 1), null);
});

test('slots: one not in the text, out of order, or spoken in digits is refused, naming the fix', () => {
  assert.throws(() => checkSlots('One 16 ms.', [['17 ms', 'seventeen milliseconds']]), /does not have/);
  assert.throws(() => checkSlots('A 1 then 2.', [['2', 'two'], ['1', 'one']]), /in order/);
  assert.throws(() => checkSlots('A 2.', [['2', 'two 2']]), /say it in words/);
  assert.throws(() => checkSlots('A 2.', [['2']]), /must be \[shown, spoken\]/);
  assert.throws(() => checkSlots('A 2.', []), /slots must list pairs \[shown, spoken\], e\.g\. "slots": \[\["16\.67 ms"/);
  assert.throws(() => checkSlots('In 2012 they left.', [['2', 'two']], { name: 'storyboard scene a', field: 'say' }),
    /^Error: storyboard scene a: say\[0\] shows "2", which the narration does not have as a whole \(not inside a longer number or word\); each shown text must appear in the narration, in order$/);
  assert.throws(() => spokenMap('One 16 ms.', { slots: [['17 ms', 'seventeen milliseconds']] }), /^Error: the text: slots\[0\] shows "17 ms"/);
  assert.throws(() => spokenMap('x', { slots: 'x' }), /slots must list pairs/);
});

test('slots: numbers left as digits are listed; a slot is a position, so the same digits written again are listed', () => {
  assert.deepEqual(unsaidDigits(spokenMap('In 1868, at 16.67 ms.', { slots: [['16.67 ms', 'sixteen point six seven milliseconds']] })), ['1868']);
  const twice = spokenMap('At 60 Hz the screen redraws at 60 Hz.', { slots: [['60 Hz', 'sixty hertz']] });
  assert.equal(twice.spoken, 'At sixty hertz the screen redraws at 60 Hz.');
  assert.deepEqual(unsaidDigits(twice), ['60']);
  const nested = spokenMap('Take 2 steps, then 12 more.', { slots: [['2', 'two'], ['12', 'twelve']] });
  assert.equal(nested.spoken, 'Take two steps, then twelve more.');
  assert.deepEqual(unsaidDigits(nested), [], 'a slot inside another number is no number left unsaid');
  assert.deepEqual(unsaidDigits(spokenMap('p95 at 3.5 and _5', { rules: AUTO })), [], 'the rules say every ASCII number; a pause is not said');
});

test('slots: one stands whole — "2" is not found inside 12, B2 or 2012', () => {
  assert.equal(spokenMap('Take 12 steps, then 2 more.', { slots: [['2', 'two']] }).spoken, 'Take 12 steps, then two more.');
  assert.equal(spokenMap('Pick the B2 seat, row 2.', { slots: [['2', 'two']] }).spoken, 'Pick the B2 seat, row two.');
  assert.equal(spokenMap('In 2012, 2 sheep left.', { slots: [['2', 'two']] }).spoken, 'In 2012, two sheep left.');
  assert.throws(() => checkSlots('In 2012 they left.', [['2', 'two']]), /does not have as a whole/);
  assert.deepEqual(unsaidDigits(spokenMap('Take 12 steps, then 2 more.', { slots: [['2', 'two']] })), ['12']);
  assert.equal(findSlot('a 2 b', '2'), 2);
  assert.equal(findSlot('(2)', '(2)'), 0, 'a shown text that starts and ends with a symbol joins nothing');
  assert.equal(findSlot('12', '2'), -1);
  assert.equal(findSlot('a', ''), -1, 'an empty shown text stands nowhere');
  assert.throws(() => findSlot('a', null), /must be strings/);
});

test('slots: captions put the digits where the slot is, keep the punctuation around it, and a word the slot is joined to', () => {
  assert.equal(capt(spokenMap('Three sheep went out, and 3 came home.', { slots: [['3', 'three']] })), 'Three sheep went out, and 3 came home.');
  assert.equal(capt(spokenMap('Refresh at ("60 Hz") today.', { slots: [['60 Hz', 'sixty hertz']] })), 'Refresh at ("60 Hz") today.');
  assert.equal(capt(spokenMap('A 3-pebble bag.', { slots: [['3', 'three']] })), 'A 3-pebble bag.');
  assert.equal(capt(spokenMap('Wait 2—then go.', { slots: [['2', 'two']] })), 'Wait 2—then go.');
  assert.equal(capt(spokenMap('Take 2 steps, then 12 more.', { slots: [['2', 'two'], ['12', 'twelve']] })), 'Take 2 steps, then 12 more.');
  assert.equal(capt(spokenMap('A 3-4 split.', { slots: [['3', 'three'], ['4', 'four']] })), 'A 3-4 split.');
  assert.equal(capt(spokenMap('Score 3-4 then 5 more.', { slots: [['3', 'three'], ['4', 'four'], ['5', 'five']] })), 'Score 3-4 then 5 more.');
});

test('shownWords: a rule\'s run shows as written too; words that do not spell the map are given back as they are', () => {
  assert.equal(capt(spokenMap('The UI’s 3 tabs cost p95 1,250 ms.', { rules: AUTO })), 'The UI’s 3 tabs cost p95 1,250 ms.');
  const map = spokenMap(frame[0], { slots: frame[1] }), words = evenWords('Something else entirely.');
  assert.equal(shownWords(map, words), words);
  const plain = evenWords('No slots here.');
  assert.equal(shownWords(spokenMap('No slots here.'), plain), plain, 'nothing said differently: the same words');
  assert.equal(shownWords(null, plain), plain);
  // an aligner may run words together; a pause is not said, so nothing of it comes back into a word
  const merged = (text) => [{ text, start: 0, end: 1 }];
  assert.equal(shownWords(spokenMap('Wait, 🤔? Yes.', { rules: AUTO }), merged('Wait?Yes.'))[0].text, 'Wait?Yes.');
  assert.equal(shownWords(spokenMap('Go — now.', { rules: AUTO }), merged('Go,now.'))[0].text, 'Go,now.');
  assert.equal(shownWords(spokenMap('The UI — 3 tabs.', { rules: AUTO }), merged('TheUI,threetabs.'))[0].text, 'TheUI,3tabs.');
});

test('a strategy is held to the law: it may say the text between slots differently, and nothing else', () => {
  const strategy = (name, change) => ({ name, apply: (pieces) => change(pieces.map((p) => ({ ...p }))) });
  const map = (rules) => spokenMap('Say 2 now.', { slots: [['2', 'two']], rules });
  assert.throws(() => map(strategy('loud', (ps) => ps.map((p) => (p.kind === 'text' ? { ...p, spoken: p.spoken.toUpperCase() } : p)))), /the rules "loud" left a text piece saying something else/);
  assert.throws(() => map(strategy('odd', (ps) => ps.map((p) => ({ ...p, kind: p.kind === 'text' ? 'aside' : p.kind })))), /the rules "odd" made a piece of no known kind/);
  assert.throws(() => map(strategy('slotty', (ps) => ps.map((p) => (p.kind === 'slot' ? { ...p, spoken: 'deux' } : p)))), /the rules "slotty" changed a slot/);
  const inPlace = (change) => ({ name: 'in place', apply: (ps) => { for (const p of ps) if (p.kind === 'slot') change(p); return ps; } });
  assert.throws(() => map(inPlace((p) => { p.spoken = 'deux'; })), /changed a slot/, 'an edit in place is seen too');
  assert.throws(() => map(inPlace((p) => { p.kind = 'rule'; })), /changed a slot/);
  // composed before the automatic rules: a strategy that silences citations, then autoRules — the pieces still join back
  const quiet = { name: 'quiet-citations', apply: (pieces) => pieces.flatMap((p) => (p.kind !== 'text' ? [p] : p.shown.split(/(\[\d+\])/).filter(Boolean)
    .map((s) => (/^\[\d+\]$/.test(s) ? { shown: s, spoken: '', kind: 'rule' } : { shown: s, spoken: s, kind: 'text' })))) };
  const both = { name: 'quiet, then auto', apply: (pieces) => AUTO.apply(quiet.apply(pieces)) };
  const said = spokenMap('Fast [1] — enough.', { rules: both });
  assert.equal(said.spoken, 'Fast, enough.');
  assert.equal(said.pieces.map((p) => p.shown).join(''), 'Fast [1] — enough.');
});

test('slots and rules together: a slot says what the rules would get wrong; the rules say the rest', () => {
  const map = spokenMap('It took 1,250 ms — then 3 more.', { slots: [['1,250 ms', 'twelve hundred fifty milliseconds']], rules: AUTO });
  assert.equal(map.spoken, 'It took twelve hundred fifty milliseconds, then three more.');
  assert.deepEqual(map.pieces.map((p) => p.kind), ['text', 'slot', 'pause', 'text', 'rule', 'text']);
  assert.equal(capt(map), 'It took 1,250 ms, then 3 more.');
  // what a slot says is final: a pause never takes its mark, and its letterless word is not a pause
  assert.equal(spokenMap('At X — go.', { slots: [['X', 'ex,']], rules: AUTO }).spoken, 'At ex, go.');
  assert.equal(spokenMap('At X ?! go.', { slots: [['X', 'ex,']], rules: AUTO }).spoken, 'At ex,?! go.');
});
