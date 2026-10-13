/**
 * footprint-narration/voice (voice.js) — a narration in a voice: one clip per text, cached by its recipe. Node only.
 */
import type { WordTiming } from './index.js';

/**
 * The voice profile's settings that shape a clip (any other field — description, consent, reference — is not part of the recipe).
 * `engine: 'recorded'` marks a recorded session's profile (recordedTakes): only its own engine may fill its clips.
 */
export interface VoiceProfile { id: string; exaggeration?: number; cfgWeight?: number; seed?: number; sentenceGapSeconds?: number; takes?: Record<string, unknown>; engine?: string }
/**
 * How a recorded take was cut (seconds): its length, the clip's, the part of the take kept, the silence cut and the silence added before its first sound
 * and after its last (every clip has exactly the lead and tail), and each inner pause capped.
 */
export interface TakeTrim { length: number; clip: number; kept: number; cutBefore: number; cutAfter: number; padBefore: number; padAfter: number; pauses: { at: number; was: number; now: number }[] }
/** How a recorded take's words were heard (check_words.py's report): mean aligner score, the words scored under 0.3, the letters heard against the text's (0–1). */
export interface TakeCheck { words: number; meanScore: number; lowWords: [word: string, score: number][]; letterMatch: number }
/** The record of a clip cut from a recorded take: its file (in the takes folder) and the verdicts of its steps. */
export interface TakeRecord { file: string; trim: TakeTrim; check: TakeCheck }
/**
 * A cached clip: its key, its audio file (.wav, else .m4a), its length, each sentence's start (s), its timed words (null when it kept none: voiced
 * before 0.1.0, or by an engine that aligns none), and the record of the recorded take it was cut from (null for a clip a voice made).
 */
export interface Clip { key: string; audio: string; duration: number; sentences: number[]; words: WordTiming[] | null; take: TakeRecord | null }
/** What an engine gives back for one scene: its audio file, its length (s), its aligned words, and — from a recorded take — the take's record. */
export interface Synthesized { id: string; audio: string; duration: number; words?: readonly WordTiming[]; take?: TakeRecord }
/** One scene to voice: its id and the text it says. */
export interface Scene { id: string; text: string }
/**
 * The voice port: synthesize scenes into audio files with their aligned words, working in `work`. A recorded engine names its session's profile
 * (`profile`, engine 'recorded': voiceClips refuses another); one with a `preflight` is handed every scene to voice, and the work folder (absolute, when
 * one is given), before the first batch, to refuse them all at once.
 */
export interface VoiceEngine {
  name: string;
  synthesize(scenes: Scene[], options: { work: string }): Synthesized[] | Promise<Synthesized[]>;
  profile?: VoiceProfile;
  preflight?(scenes: Scene[], options?: { work?: string }): void | Promise<void>;
}
/** How a command is run (child_process.spawnSync's shape), so a test can stand in for it. */
export type Run = (command: string, args: string[], options?: object) => { status: number | null; signal?: string | null; error?: Error; stderr?: string | Uint8Array | null };
/**
 * How a recorded take is trimmed. threshold: the level (dB below full scale, RMS per 10 ms) under which it is silent (-45). lead, tail: the silence
 * (s) every clip has before its first sound and after its last — cut or padded to exactly that (0.2, 0.4: the kit's own). maxPause: the longest inner
 * pause kept whole (0.6 s). minSound: the shortest sound that is surely speech (0.1 s); a shorter one at either end is a word when it is within
 * maxPause of the speech, and a click when it is farther.
 */
export interface TrimSettings { threshold?: number; lead?: number; tail?: number; maxPause?: number; minSound?: number }

/** The cache key of a clip: sha1 (12 hex) of the profile's settings and the exact text. Stable across versions. */
export function clipKey(text: string, profile: VoiceProfile): string;
/** The cached clip for a text, or null. */
export function clipFor(text: string, options: { cache: string; profile: VoiceProfile }): Clip | null;
/** "1-3,7" → Set {1, 2, 3, 7} (1-based steps); null for all; anything else is refused. */
export function pickSteps(spec?: string | number | null): Set<number> | null;
/**
 * Voices every text whose clip is not cached, in batches, each cached as soon as it is done. `work` (emptied before each batch) defaults to a
 * temporary folder, removed afterwards; `batch` is a whole number, 1 or more. Paths may be relative. A recorded session's profile and engine
 * go together: any other pairing is refused. With no engine it only counts what is cached (a text still to voice is then an error).
 */
export function voiceClips(texts: readonly string[], options: {
  cache: string; profile: VoiceProfile; engine?: VoiceEngine; only?: ReadonlySet<number> | null; batch?: number; work?: string; log?: (line: string) => void;
}): Promise<{ wanted: number; todo: number; voiced: number }>;
/** The adapter for a local voice kit (Chatterbox, aligned; nothing is uploaded). */
export function chatterboxKit(options: { kit: string; python?: string; script?: string; profile?: string; device?: string; env?: Record<string, string | undefined>; run?: Run }): VoiceEngine;
/**
 * The adapter for your own recorded takes: a `takes` folder of one recording per line (WAV or M4A) and its takes.json (`manifest`), { "<line>": "<file>" }.
 * Each take is found, trimmed (ffmpeg), aligned to its text (the kit's MMS_FA aligner, offline) and checked. Use its `profile` with voiceClips and clipFor.
 * Only for your own voice.
 */
export function recordedTakes(options: {
  kit: string; takes: string; manifest?: string; python?: string; ffmpeg?: string; trim?: TrimSettings;
  env?: Record<string, string | undefined>; run?: Run; log?: (line: string) => void;
}): VoiceEngine & { profile: VoiceProfile; preflight(scenes: Scene[], options?: { work?: string }): void };
