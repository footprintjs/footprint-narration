// A clip's key — its recipe's hash. Moved from StoryDeck 0.2.0 (voice.js · clipKey), byte for byte: every clip a
// deck has already voiced is found by this exact spelling, so it is never "improved" (no sorted keys, no other hash).
import { createHash } from 'node:crypto';

/**
 * The cache key of a clip: sha1 (first 12 hex) of what the voice says and the profile settings it says it with —
 * `JSON.stringify({ id, exaggeration, cfgWeight, seed, gap, takes, text })`, in that order. Any other field of
 * the profile (its description, consent, reference recording) is not part of the recipe.
 */
export function clipKey(text, profile) {
  const recipe = { id: profile.id, exaggeration: profile.exaggeration, cfgWeight: profile.cfgWeight, seed: profile.seed, gap: profile.sentenceGapSeconds, takes: profile.takes ?? {}, text };
  return createHash('sha1').update(JSON.stringify(recipe)).digest('hex').slice(0, 12);
}
