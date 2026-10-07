// Rules — the automatic strategy: what a voice says for text nobody marked by hand. Moved from StoryDeck 0.2.0
// (narration.js · narrationText), stage for stage, now recorded as pieces.
//
// What a voice taught us, kept as defaults: an acronym stays as written (a cloned voice says LLM, HCI, MCP as quick
// letters; spaced out, "L L M" came out slow and odd), and only the ones it misreads as a word are spelled (SPELL:
// UI, API). Numbers become words, because a forced aligner only knows letters.
import { digitWords } from './digits.js';
import { rewrite } from './pieces.js';
import { pauses } from './pauses.js';

/** Words a voice misreads as a word, and how to say them: spelled. Every other acronym stays as written. */
export const SPELL = Object.freeze({ UI: 'U I', API: 'A P I', APIs: 'A P Is' });

/**
 * A symbol standing alone, said as the word it means (a trailing . , ; : ! ? stays): & and, + plus, = equals,
 * < less than and > more than (before a number only: "File > Save As" is a menu path, a pause), × times,
 * % percent, and the Greek letters people write in talks.
 */
export const SAY = Object.freeze({
  '&': 'and', '+': 'plus', '=': 'equals', '<': 'less than', '>': 'more than', '×': 'times', '%': 'percent',
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', Δ: 'delta', ε: 'epsilon', θ: 'theta', λ: 'lambda', μ: 'mu',
  π: 'pi', σ: 'sigma', Σ: 'sigma', φ: 'phi', ω: 'omega', Ω: 'omega',
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Where a word ENDS, for a substitution — Unicode-aware (\b only knows A–Z, 0–9 and _), written without lookbehind
// (older Safari). Comparing two spellings is normSpeech's question, not this one.
const EDGE = '[^\\p{L}\\p{N}_]';
// symbols said only before a number: a comparison then, a menu path's arrow otherwise
const BEFORE_A_NUMBER = new Set(['<', '>']);
const lone = (keys) => `(^|\\s)(${keys.map(escapeRe).join('|')})`;

/**
 * A spell or say list, checked and copied: each key one word (not empty, no white space), each value words with a
 * letter in every one and no digit — what the voice says must be sayable, and a word without a letter would be a
 * pause — that does not end in , ; or : (a clause mark belongs to the text: a pause after the word may move it).
 * A value's white space is tidied: trimmed, and one space inside.
 */
function checkList(list, name, example) {
  if (!list || typeof list !== 'object' || Array.isArray(list)) throw new TypeError(`autoRules: ${name} must be an object of what is written → how it is said, e.g. ${example}`);
  return Object.freeze(Object.fromEntries(Object.entries(list).map(([key, value]) => {
    if (!key || /\s/.test(key)) throw new TypeError(`autoRules: a ${name} key must be one word (not empty, no white space), not ${JSON.stringify(key)}`);
    const said = typeof value === 'string' ? value.trim().split(/\s+/).join(' ') : '';
    if (!said || /\p{N}/u.test(said) || !said.split(' ').every((w) => /\p{L}/u.test(w)) || /[,;:]$/.test(said)) throw new TypeError(`autoRules: ${name}[${JSON.stringify(key)}] must be what the voice says, in words — a letter in every word, no digits, and no comma, semicolon or colon at its end — not ${JSON.stringify(value)}`);
    return [key, said];
  })));
}

/**
 * The automatic strategy, as a frozen value to hand to spokenMap: `spell` words spelled (at Unicode word edges),
 * a lone `<` or `>` before a number said, p-numbers ("p95" → "p ninety-five") and numbers said in words, a lone
 * `say` symbol said (its trailing . , ; : ! ? kept), and every other word without a letter a pause (pauses.js).
 * The stages run in that order over the text between slots; what a stage says is final — no later stage, and no
 * later spell entry, reads it again. A word in another script gets its reading through `spell`
 * (`{ 日本: 'Japan' }`): the local voice kit's aligner knows Latin letters only.
 */
export function autoRules({ spell = SPELL, say = SAY } = {}) {
  const spelled = checkList(spell, 'spell', "{ UI: 'U I' }"), said = checkList(say, 'say', "{ '&': 'and' }");
  const spellings = Object.entries(spelled).map(([word, value]) => [new RegExp(`(^|${EDGE})${escapeRe(word)}(?=${EDGE}|$)`, 'gu'), word.length, value]);
  const symbols = Object.keys(said).filter((k) => !BEFORE_A_NUMBER.has(k)), compare = Object.keys(said).filter((k) => BEFORE_A_NUMBER.has(k));
  const compareRe = compare.length ? new RegExp(`${lone(compare)}(?=\\s+[-+]?\\d)`, 'gu') : null;
  const symbolRe = symbols.length ? new RegExp(`${lone(symbols)}([.,;:!?]*)(?=\\s|$)`, 'gu') : null;
  const sayLone = (m) => ({ at: m.index + m[1].length, length: m[2].length, spoken: said[m[2]] });

  function apply(pieces) {
    for (const [re, length, value] of spellings) pieces = rewrite(pieces, re, (m) => ({ at: m.index + m[1].length, length, spoken: value }));
    if (compareRe) pieces = rewrite(pieces, compareRe, sayLone);
    pieces = rewrite(pieces, /\bp(\d+)\b/g, (m) => ({ at: m.index, length: m[0].length, spoken: `p ${digitWords(m[1])}` }));
    pieces = rewrite(pieces, /\b\d+\b/g, (m) => ({ at: m.index, length: m[0].length, spoken: digitWords(m[0]) }));
    if (symbolRe) pieces = rewrite(pieces, symbolRe, sayLone);
    return pauses(pieces);
  }
  return Object.freeze({ name: 'auto', spell: spelled, say: said, apply });
}
