// footprint-narration/voice — a narration in a voice: one clip per text, cached by its recipe. Node only.
//
//   const engine = chatterboxKit({ kit: '../voice-kit' });       // an adapter of the voice port: a local voice kit
//   await voiceClips(texts, { cache, profile, engine });         // voices only the texts whose clip is not cached
//   clipFor(texts[i], { cache, profile })                        // → { key, audio, duration, sentences, words } or null

export { clipKey } from './src/voice/key.js';
export { clipFor, pickSteps, voiceClips } from './src/voice/cache.js';
export { chatterboxKit } from './src/voice/chatterbox.js';
