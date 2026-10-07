// Sentences as a voice script splits them. Moved from StoryDeck 0.2.0 (narration.js · sentences, saidSentences).

/** Sentences as a voice script splits them: after . ? or ! and a space (no lookbehind: older Safari can't parse one). */
export const sentences = (text) => String(text ?? '').trim().replace(/([.?!])\s+/g, '$1\u0000').split('\u0000').filter(Boolean);

/**
 * The written sentences the voice says: one with no letter and no digit (a lone "...") is never said, so it joins
 * the sentence before it (or, at the start, the one after) — the written and the spoken text then split alike.
 */
export function saidSentences(text) {
  const out = [];
  let lead = '';
  for (const s of sentences(text)) {
    if (/[\p{L}\p{N}]/u.test(s)) { out.push(lead + s); lead = ''; }
    else if (out.length) out[out.length - 1] += ` ${s}`;
    else lead += `${s} `;
  }
  return out;
}
