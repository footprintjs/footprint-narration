// Pauses — a spoken word with no letter (— – · → - / ... … -- -> * | an emoji) is not said: a voice aligner
// needs letters in every word. StoryDeck 0.2.0's law (narration.js · pause), moved, now recorded as pieces.
import { spokenOf, textPiece } from './pieces.js';

const LETTER = /\p{L}/u;

/**
 * What the word before says once `word` (no letter) is not said: its sentence end (. ? !) moves onto it — so the
 * voice still ends the sentence there, and a comma, semicolon or colon it ended with yields — or else it gets a
 * comma, unless it ends in a stop already.
 */
function settle(before, word) {
  const end = /[.?!]+$/.exec(word)?.[0];
  if (end) return /[.?!]$/.test(before) ? before : before.replace(/[,;:]$/, '') + end;
  return /[,.;:!?]$/.test(before) ? before : `${before},`;
}

/** Per spoken code unit: does it belong to a text piece (the only kind a pause may cut)? */
function textMask(pieces) {
  const mask = [];
  for (const p of pieces) for (let i = 0; i < p.spoken.length; i++) mask.push(p.kind === 'text');
  return mask;
}

/**
 * The words not said, as edits on the spoken text: `{ from, to, add }` — spoken[from, to) is not said and `add` is
 * said in its place. A run of them at the start goes with the white space after it; after a word, a run goes with
 * the white space before it, and the word before changes its last mark as `settle` says. A word is a pause only
 * when it lies in text pieces, and the mark the word before gives up is taken only from a text piece: what a
 * slot or a rule says is final.
 */
function pauseEdits(spoken, mask) {
  const inText = (from, to) => mask.slice(from, to).every(Boolean);
  const words = [...spoken.matchAll(/\S+/g)].map((m) => ({ from: m.index, to: m.index + m[0].length, text: m[0] }));
  const edits = [];
  let last = null;
  words.forEach((w, k) => {
    if (LETTER.test(w.text) || !inText(w.from, w.to)) { last = { to: w.to, text: w.text, edit: null }; return; }
    if (!last) {   // at the start: nothing before it to carry its mark
      const to = words[k + 1]?.from ?? spoken.length, lead = edits.at(-1);
      if (lead?.to === w.from) lead.to = to;
      else edits.push({ from: w.from, to, add: '' });
      return;
    }
    if (!last.edit) edits.push(last.edit = { from: last.to, to: last.to, add: '', before: last.text, after: last.text });
    last.edit.to = w.to;
    last.edit.after = settle(last.edit.after, w.text);
  });
  for (const e of edits.filter((x) => x.before !== undefined)) {
    let same = 0;
    while (same < e.before.length && e.before[same] === e.after[same]) same++;
    if (same < e.before.length && mask[e.from - 1]) e.from -= 1;   // the one mark the word before gives up
    e.add = e.after.slice(same);
  }
  return edits;
}

/**
 * The pieces with the edits made: a text piece is cut where an edit begins or ends; what an edit takes from text
 * pieces becomes a 'pause' piece { shown: what is not said, spoken: what is said in its place }, placed where the
 * edit begins. Any other piece is kept whole — and when one stands inside an edit, the edit's text after it is a
 * second pause piece that says nothing, so the pieces still join back in order.
 */
function cut(pieces, edits) {
  const out = [], placed = new Set();   // the edits whose words-in-place are said already
  let start = 0, e = 0, open = null;    // open: the pause piece still taking an edit's text, and that edit
  for (const p of pieces) {
    const end = start + p.spoken.length;
    if (p.kind !== 'text' || start === end) { out.push(p); if (p.kind !== 'text') open = null; start = end; continue; }
    for (let from = start; from < end;) {
      while (e < edits.length && edits[e].to <= from) e++;
      const edit = edits[e];
      if (!edit || edit.from >= end) { out.push(from === start ? p : textPiece(p.spoken.slice(from - start))); break; }
      if (edit.from > from) { out.push(textPiece(p.spoken.slice(from - start, edit.from - start))); from = edit.from; }
      if (open?.edit !== edit) {
        open = { edit, piece: { shown: '', spoken: placed.has(edit) ? '' : edit.add, kind: 'pause' } };
        placed.add(edit); out.push(open.piece);
      }
      const to = Math.min(edit.to, end);
      open.piece.shown += p.spoken.slice(from - start, to - start);
      from = to;
    }
    start = end;
  }
  return out;
}

/**
 * The pause rule over pieces: every spoken word with no letter, in a text piece, is not said — dropped at the
 * start; after a word, its sentence end moves onto that word ("Ship it 🚀. Then" → "Ship it. Then"), else that
 * word gets a comma unless it ends in a stop ("Done. — Then" → "Done. Then"). Each run of such words, with the
 * white space it goes with and the mark the word before gives up, is one 'pause' piece.
 */
export function pauses(pieces) {
  const spoken = spokenOf(pieces), mask = textMask(pieces);
  const edits = pauseEdits(spoken, mask);
  return edits.length ? cut(pieces, edits) : pieces;
}
