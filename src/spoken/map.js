// The shown↔spoken map: one text, as a caption shows it and as a voice says it, piece by piece. Two strategies
// make it — slots (explicit pairs, slots.js) and rules (automatic, rules.js) — alone or together.
import { normSpeech } from './normSpeech.js';
import { checkSlots, slotPieces } from './slots.js';

/**
 * The map in letters-and-digits offsets (normSpeech, piece by piece — as footprint-storyreel built it): each piece's
 * range in the text as shown [n0, n1) and as spoken [s0, s1), and `slot` — what it shows when it says something
 * else (null for a piece said as written).
 */
function normOf(pieces) {
  let shown = '', spoken = '';
  const map = pieces.map((p) => {
    const a = normSpeech(p.shown), b = normSpeech(p.spoken);
    const m = { n0: shown.length, n1: shown.length + a.length, s0: spoken.length, s1: spoken.length + b.length, slot: p.kind === 'text' ? null : p.shown };
    shown += a; spoken += b;
    return m;
  });
  return { shown, spoken, map };
}

const KINDS = new Set(['text', 'slot', 'rule', 'pause']);
const slotsIn = (pieces) => pieces.filter((p) => p.kind === 'slot').map((p) => [p.shown, p.spoken]);

/**
 * Refuses pieces a strategy made against the law: only the text between slots may be said differently, and only as a
 * rule or a pause. `slots` is the slot pieces as they were before the strategy ran (a strategy may edit its pieces in place).
 */
function checkRules(rules, slots, after, text) {
  const refuse = (what) => { throw new Error(`spokenMap: the rules "${rules.name}" ${what}; a rule may change only what the text between slots says`); };
  if (after.map((p) => p.shown).join('') !== text) refuse('changed the text as shown');
  if (after.some((p) => !KINDS.has(p.kind))) refuse(`made a piece of no known kind (${[...KINDS].join(', ')})`);
  if (after.some((p) => p.kind === 'text' && p.shown !== p.spoken)) refuse('left a text piece saying something else (that is a rule piece)');
  if (JSON.stringify(slotsIn(after)) !== slots) refuse('changed a slot');
}

/**
 * THE function: `text` as shown and as spoken. `slots` ([[shown, spoken], …], checked by checkSlots) are said as
 * they say, where they stand; `rules` (a strategy such as autoRules()) say the text between them. Returns
 * `{ shown, spoken, pieces, norm }`: the pieces ({ shown, spoken, kind: 'text' | 'slot' | 'rule' | 'pause' })
 * joined give back both texts exactly, and `norm` is the same map in letters-and-digits offsets.
 */
export function spokenMap(text, { slots, rules } = {}) {
  if (typeof text !== 'string') throw new TypeError(`spokenMap: text must be a string, not ${text === null ? 'null' : typeof text}`);
  const list = slots ?? [];
  if (!Array.isArray(list) || list.length) checkSlots(text, list);
  if (rules && typeof rules.apply !== 'function') throw new TypeError('spokenMap: rules must be a strategy { name, apply(pieces) }, e.g. autoRules()');
  let pieces = slotPieces(text, list);
  if (rules) {
    const slots = JSON.stringify(slotsIn(pieces));   // before apply: it may edit the pieces in place
    pieces = rules.apply(pieces);
    checkRules(rules, slots, pieces, text);
  }
  return { shown: text, spoken: pieces.map((p) => p.spoken).join(''), pieces, norm: normOf(pieces) };
}

/**
 * A letters-and-digits offset in the text as shown, in the spoken text — or null past its end. Inside a piece
 * that says something else it snaps to the piece's edge (a phrase that covers part of a slot covers all of it):
 * its start, or its end with `end: true`.
 */
export function spokenOffset(map, at, { end = false } = {}) {
  for (const m of map.norm.map) if (at >= m.n0 && at <= m.n1) return !m.slot ? m.s0 + (at - m.n0) : at === m.n0 ? m.s0 : at === m.n1 ? m.s1 : end ? m.s1 : m.s0;
  return null;
}

/**
 * Every run of digits a voice would have to read as digits: those in the text said as written (a slot's or a
 * rule's place is blanked, since its digits are said in words; a pause is not said at all). A voice tool can
 * refuse these before it speaks: a voice drops or garbles digits.
 */
export function unsaidDigits(map) {
  const said = map.pieces.map((p) => (p.kind === 'text' ? p.shown : ' ')).join('');
  return [...said.matchAll(/[0-9][0-9.,:]*/g)].map((m) => m[0].replace(/[.,:]+$/, ''));
}
