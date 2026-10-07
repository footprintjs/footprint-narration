// Slots — the explicit strategy: [[shown, spoken], …], the text shows `shown` ("16.67 ms") where the voice says
// `spoken` ("sixteen point six seven milliseconds"). A voice drops or garbles digits, so a number is written for
// the voice in words and shown on screen in digits. Moved from footprint-storyreel 0.9.0 (clock.mjs · checkSay,
// findSlot, slotPieces) with the text and the list as arguments instead of a scene.
import { normSpeech } from './normSpeech.js';

const WORD = /[\p{L}\p{N}]/u;

/**
 * Where a slot's shown text is in `text`, from `from`: the first place it stands whole — not inside a longer
 * number or word ("2" is not in "12", "B2" or "2012") — or -1.
 */
export function findSlot(text, shown, from = 0) {
  if (typeof text !== 'string' || typeof shown !== 'string') throw new TypeError('findSlot: the text and the shown text must be strings');
  if (!shown) return -1;   // nothing stands whole
  const joinsLeft = WORD.test(shown[0]), joinsRight = WORD.test(shown.at(-1));
  for (let at = text.indexOf(shown, from); at >= 0; at = text.indexOf(shown, at + 1)) {
    if (joinsLeft && at > 0 && WORD.test(text[at - 1])) continue;
    if (joinsRight && at + shown.length < text.length && WORD.test(text[at + shown.length])) continue;
    return at;
  }
  return -1;
}

/**
 * Refuses, naming the fix, unless `slots` lists pairs [shown, spoken] of strings with words, no spoken text has
 * digits (that is the point), and each shown text stands whole in `text`, in order (each after the one before).
 * `name` says whose text it is and `field` what the list is called there, as the messages name them.
 */
export function checkSlots(text, slots, { name = 'the text', field = 'slots' } = {}) {
  if (!Array.isArray(slots) || !slots.length) throw new TypeError(`${name}: ${field} must list pairs [shown, spoken], e.g. "${field}": [["16.67 ms", "sixteen point six seven milliseconds"]]`);
  let from = 0;
  slots.forEach((pair, k) => {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((x) => typeof x === 'string' && normSpeech(x))) throw new TypeError(`${name}: ${field}[${k}] must be [shown, spoken], two strings with words, not ${JSON.stringify(pair)}`);
    const [shown, said] = pair;
    if (/[0-9]/.test(said)) throw new Error(`${name}: ${field}[${k}] "${said}" has digits; say it in words (a voice drops or garbles digits)`);
    const at = findSlot(text, shown, from);
    if (at < 0) throw new Error(`${name}: ${field}[${k}] shows "${shown}", which the narration does not have as a whole${from ? ' after the slot before it' : ''} (not inside a longer number or word); each shown text must appear in the narration, in order`);
    from = at + shown.length;
  });
  return slots;
}

/**
 * The text in pieces: the text between slots (kind 'text'), and each slot where it stands (kind 'slot') —
 * found as checkSlots finds them. A slot is a POSITION: a shown text written again elsewhere is not a slot
 * there. The pieces alternate text, slot, text, … and start and end with text (an empty piece is kept).
 */
export function slotPieces(text, slots) {
  const pieces = [];
  let from = 0;
  for (const [shown, spoken] of slots) {
    const at = findSlot(text, shown, from);
    const before = text.slice(from, at);
    pieces.push({ shown: before, spoken: before, kind: 'text' }, { shown, spoken, kind: 'slot' });
    from = at + shown.length;
  }
  const rest = text.slice(from);
  pieces.push({ shown: rest, spoken: rest, kind: 'text' });
  return pieces;
}
