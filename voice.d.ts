/**
 * footprint-narration/voice (voice.js) — a narration in a voice: one clip per text, cached by its recipe. Node only.
 */
import type { WordTiming } from './index.js';

/** The voice profile's settings that shape a clip (any other field — description, consent, reference — is not part of the recipe). */
export interface VoiceProfile { id: string; exaggeration?: number; cfgWeight?: number; seed?: number; sentenceGapSeconds?: number; takes?: Record<string, unknown> }
/** A cached clip: its key, its audio file (.wav, else .m4a), its length, each sentence's start (s), and its timed words (null when it kept none: voiced before 0.1.0, or by an engine that aligns none). */
export interface Clip { key: string; audio: string; duration: number; sentences: number[]; words: WordTiming[] | null }
/** What an engine gives back for one scene: its audio file, its length (s), and its aligned words. */
export interface Synthesized { id: string; audio: string; duration: number; words?: readonly WordTiming[] }
/** The voice port: synthesize scenes ({ id, text }) into audio files with their aligned words, working in `work`. */
export interface VoiceEngine {
  name: string;
  synthesize(scenes: { id: string; text: string }[], options: { work: string }): Synthesized[] | Promise<Synthesized[]>;
}
/** How a command is run (child_process.spawnSync's shape), so a test can stand in for it. */
export type Run = (command: string, args: string[], options?: object) => { status: number | null; signal?: string | null; error?: Error };

/** The cache key of a clip: sha1 (12 hex) of the profile's settings and the exact text. Stable across versions. */
export function clipKey(text: string, profile: VoiceProfile): string;
/** The cached clip for a text, or null. */
export function clipFor(text: string, options: { cache: string; profile: VoiceProfile }): Clip | null;
/** "1-3,7" → Set {1, 2, 3, 7} (1-based steps); null for all; anything else is refused. */
export function pickSteps(spec?: string | number | null): Set<number> | null;
/**
 * Voices every text whose clip is not cached, in batches, each cached as soon as it is done. `work` (emptied before each batch) defaults to a
 * temporary folder, removed afterwards; `batch` is a whole number, 1 or more. Paths may be relative.
 */
export function voiceClips(texts: readonly string[], options: {
  cache: string; profile: VoiceProfile; engine: VoiceEngine; only?: ReadonlySet<number> | null; batch?: number; work?: string; log?: (line: string) => void;
}): Promise<{ wanted: number; todo: number; voiced: number }>;
/** The adapter for a local voice kit (Chatterbox, aligned; nothing is uploaded). */
export function chatterboxKit(options: { kit: string; python?: string; script?: string; profile?: string; device?: string; env?: Record<string, string | undefined>; run?: Run }): VoiceEngine;
