// Pieces — the unit of the shown↔spoken map: { shown, spoken, kind }. Joined in order, the pieces give back the
// text as shown and the text as spoken, exactly. Only a 'text' piece (said as written: shown === spoken) is ever
// rewritten; a 'slot', 'rule' or 'pause' piece is final — what it says is never read again by a rule.

/** A piece said as written. */
export const textPiece = (s) => ({ shown: s, spoken: s, kind: 'text' });

/** The pieces' spoken text, joined. */
export const spokenOf = (pieces) => pieces.map((p) => p.spoken).join('');

/**
 * Rewrites what is said. Every match of the global `re` in the spoken text — found as String.replace finds them,
 * on the text as it is before this rewrite — goes to `place`, which returns the part to say differently,
 * `{ at, length, spoken }` in spoken-text offsets, or null. A part inside one text piece becomes a 'rule' piece
 * (the text around it stays text); any other part is left as it is: said text is final.
 */
export function rewrite(pieces, re, place) {
  const spoken = spokenOf(pieces);
  const cuts = [...spoken.matchAll(re)].map(place).filter(Boolean);
  if (!cuts.length) return pieces;
  const out = [];
  let start = 0, c = 0;
  for (const p of pieces) {
    const end = start + p.spoken.length;
    let from = start;
    for (; c < cuts.length && cuts[c].at < end; c++) {
      const { at, length, spoken: said } = cuts[c];
      if (p.kind !== 'text' || at + length > end) continue;   // not inside one text piece
      if (at > from) out.push(textPiece(spoken.slice(from, at)));
      out.push({ shown: spoken.slice(at, at + length), spoken: said, kind: 'rule' });
      from = at + length;
    }
    if (from === start) out.push(p);
    else if (from < end) out.push(textPiece(spoken.slice(from, end)));
    start = end;
  }
  return out;
}
