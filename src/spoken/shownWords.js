// The words to show for timed spoken words. Moved from footprint-storyreel 0.9.0 (clock.mjs · shownWords,
// letterStart, letterEnd) — it reads a spoken map instead of a scene, so it works for slots and rules alike.
import { normSpeech } from './normSpeech.js';

/** Where in `raw` its n-th letter or digit starts (raw.length past the last). */
function letterStart(raw, n) {
  let count = 0, at = 0;
  for (const ch of raw) { const k = normSpeech(ch).length; if (k && count >= n) return at; count += k; at += ch.length; }
  return raw.length;
}

/** Where in `raw` its n-th letter or digit ends (n counted from 1; the punctuation after it is not included). */
function letterEnd(raw, n) {
  let count = 0, at = 0;
  for (const ch of raw) { at += ch.length; count += normSpeech(ch).length; if (count >= n) return at; }
  return raw.length;
}

/**
 * The words to show: the timed spoken `words` ({ text, start, end }), with each run a piece said differently
 * collapsed back into what it shows, where it IS ("sixteen point six seven milliseconds." → "16.67 ms.",
 * "U I" → "UI"), timed from the run's first word to its last — so a caption shows digits while the voice said
 * words. Punctuation around the run stays ("(" … ")"), a piece joined to a word keeps the word ("three-pebble" →
 * "3-pebble"), and two pieces in one word both show ("three-four" → "3-4"). A pause is not said, so it shows
 * nothing back. Words that do not spell the map's spoken text exactly, or a map that says everything as written,
 * give the words back as they are.
 */
export function shownWords(map, words) {
  const pieces = map?.norm.map.filter((m, i) => m.slot && map.pieces[i].kind !== 'pause');   // a pause is not said: nothing to show back
  if (!pieces?.length) return words;
  let at = 0;
  const ranged = words.map((w) => { const n = normSpeech(w.text).length, r = { w, from: at, to: at + n }; at += n; return r; });
  if (at !== normSpeech(map.spoken).length) return words;
  // Units: the words each piece touches become one; pieces that touch the same word share it.
  const unitOf = ranged.map((_, i) => i), find = (i) => (unitOf[i] === i ? i : (unitOf[i] = find(unitOf[i])));
  const piecesIn = new Map();
  for (const m of pieces) {
    const touched = ranged.map((r, i) => ((r.to > m.s0 && r.from < m.s1) || (r.from === r.to && r.from > m.s0 && r.from < m.s1) ? i : -1)).filter((i) => i >= 0);
    if (!touched.length) continue;
    for (const i of touched) unitOf[find(i)] = find(touched[0]);
    const root = find(touched[0]);
    piecesIn.set(root, [...(piecesIn.get(root) ?? []), m]);
  }
  for (const [root, list] of [...piecesIn]) { const r = find(root); if (r !== root) { piecesIn.set(r, [...(piecesIn.get(r) ?? []), ...list]); piecesIn.delete(root); } }
  const out = [];
  for (let i = 0; i < ranged.length;) {
    const root = find(i);
    let j = i;
    while (j + 1 < ranged.length && find(j + 1) === root) j++;
    const list = piecesIn.get(root);
    if (!list) { out.push(ranged[i].w); i = j + 1; continue; }
    // The unit's text, each piece's run replaced by what it shows — the last first, so the earlier places hold.
    let text = ranged.slice(i, j + 1).map((r) => String(r.w.text)).join(' ');
    const base = ranged[i].from;
    for (const m of [...list].sort((a, b) => b.s0 - a.s0)) text = text.slice(0, letterStart(text, m.s0 - base)) + m.slot + text.slice(letterEnd(text, m.s1 - base));
    out.push({ text, start: ranged[i].w.start, end: ranged[j].w.end });
    i = j + 1;
  }
  return out;
}
