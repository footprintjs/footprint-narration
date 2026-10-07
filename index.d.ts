/**
 * footprint-narration — what a voice says and what a caption shows. The pure door (index.js): runs anywhere,
 * browser or Node. The voice port and the clip cache are behind 'footprint-narration/voice' (Node only).
 */

// ── spoken: one text as shown and as spoken ─────────────────────────────────────────────────────────────────

/** Letters, their combining marks and digits only, NFKC, lower case: how two spellings of what is said are compared (கடை is not கட). */
export function normSpeech(text: string): string;
/** A whole number (0 to 999 999 999 999 999) in words: 42 → "forty-two", 1000000 → "one million". */
export function numberWords(n: number): string;
/** Words a voice misreads as a word, and how to say them: spelled (UI → "U I", API → "A P I", APIs → "A P Is"). Every other acronym stays as written. */
export const SPELL: Readonly<Record<string, string>>;
/** A symbol standing alone, said as the word it means: & and, + plus, = equals, < less than and > more than (before a number only), × times, % percent, Greek letters. */
export const SAY: Readonly<Record<string, string>>;

/** One slot: the text shows `shown` ("16.67 ms") where the voice says `spoken` ("sixteen point six seven milliseconds"). */
export type Slot = readonly [shown: string, spoken: string];

/** A piece of a spoken map. Joined in order, the pieces give back the text as shown and the text as spoken, exactly. */
export interface Piece {
  shown: string;
  spoken: string;
  /** 'text' is said as written (shown === spoken); 'slot' as its slot says; 'rule' as a rule says; 'pause' (a word with no letter) is not said. */
  kind: 'text' | 'slot' | 'rule' | 'pause';
}

/** A strategy that says the text between slots: it rewrites only 'text' pieces and never changes what is shown. */
export interface Rules {
  readonly name: string;
  apply(pieces: Piece[]): Piece[];
}

/** The automatic strategy, with its lists checked and frozen. */
export interface AutoRules extends Rules {
  readonly name: 'auto';
  readonly spell: Readonly<Record<string, string>>;
  readonly say: Readonly<Record<string, string>>;
}

/**
 * The automatic strategy: `spell` words spelled, a lone < or > before a number said, p-numbers and numbers in words, a lone `say` symbol
 * said, and every other word without a letter a pause. What a stage says is final. Refuses a key that is not one word, and a value that is
 * not words (a letter in every word, no digits, no comma, semicolon or colon at its end).
 */
export function autoRules(lists?: { spell?: Readonly<Record<string, string>>; say?: Readonly<Record<string, string>> }): AutoRules;

/** Where a slot's shown text stands whole in `text`, from `from` — not inside a longer number or word — or -1. */
export function findSlot(text: string, shown: string, from?: number): number;
/** Refuses, naming the fix, unless each slot is [shown, spoken] with words, `spoken` has no digits, and each `shown` stands whole in `text`, in order. */
export function checkSlots(text: string, slots: readonly Slot[], options?: { name?: string; field?: string }): readonly Slot[];

/** A piece's range in the letters-and-digits text as shown [n0, n1) and as spoken [s0, s1); `slot` is what it shows when it says something else. */
export interface NormEntry { n0: number; n1: number; s0: number; s1: number; slot: string | null }

/** One text as shown and as spoken, piece by piece, and the same map in letters-and-digits offsets. */
export interface SpokenMap {
  shown: string;
  spoken: string;
  pieces: Piece[];
  norm: { shown: string; spoken: string; map: NormEntry[] };
}

/** THE function: `text` as shown and as spoken — `slots` said where they stand, `rules` (e.g. autoRules()) saying the text between them. */
export function spokenMap(text: string, options?: { slots?: readonly Slot[] | null; rules?: Rules | null }): SpokenMap;
/** A letters-and-digits offset in the text as shown, in the spoken text (inside a slot: its start, or its end with `end`); null past the end. */
export function spokenOffset(map: SpokenMap, at: number, options?: { end?: boolean }): number | null;
/** Every run of digits a voice would have to read as digits (those in the text said as written). */
export function unsaidDigits(map: SpokenMap): string[];

/** A timed word: its text, and when it is said — seconds from the start of its clip, scene or track. */
export interface WordTiming { text: string; start: number; end: number; speaker?: string }

/** The words to show for timed spoken words: each run a piece says differently collapsed back into what it shows, timed first to last. */
export function shownWords<W extends WordTiming>(map: SpokenMap | null | undefined, words: readonly W[]): (W | WordTiming)[];

// ── sentences ───────────────────────────────────────────────────────────────────────────────────────────────

/** Sentences as a voice script splits them: after . ? or ! and a space. */
export function sentences(text: string | null | undefined): string[];
/** The written sentences a voice says: one with no letter and no digit (a lone "...") joins its neighbour. */
export function saidSentences(text: string | null | undefined): string[];
/** Where each sentence starts: its first word's aligned start (words counted by white space); 0 for a word the aligner lost. */
export function sentenceStarts(text: string, words: readonly { start: number }[]): number[];

// ── captions ────────────────────────────────────────────────────────────────────────────────────────────────

/** A caption cue: its time and its text; a cue chunked from timed words carries them too. */
export interface Cue { start: number; end: number; text: string; words?: WordTiming[] }
/** A cue chunked from timed words. */
export interface WordCue extends Cue { words: WordTiming[] }

/** A step on a video's timeline, for sentence captions: its start, the silence before its clip, its text, and the clip's sentence starts. */
export interface CaptionStep { start: number; lead?: number; written?: string; spoken?: string; clip?: { duration: number; sentences: readonly number[] } | null }
/** Subtitles by sentence, timed by each clip's sentence starts (as written when the sentences line up, else as spoken). */
export function captionCues(steps: readonly CaptionStep[]): Cue[];

/** A stretch of speech on a shared clock: a film's scene, a deck's click. Its words' times are from its own start. */
export interface Track { offset: number; duration: number; words: readonly WordTiming[] }
/** How words are chunked: the most words and characters in a chunk, and where a chunk may end. */
export interface ChunkOptions { maxWords?: number; maxChars?: number; breaks?: 'clause' | 'sentence' }
/** The spoken words in chunks, on the tracks' clock (a chunk takes one word more only to finish a clause). */
export function captionChunks(tracks: readonly Track[], options?: ChunkOptions): WordCue[];
/** The chunk at `t`, and which of its words is being said (-1 between words); null when none shows. */
export function captionAt(chunks: readonly { start: number; end: number; words: WordTiming[] }[], t: number): { words: WordTiming[]; active: number } | null;
/** The chunks a caption FILE uses by default: sentences, at most two lines of 42 characters. */
export const FILE_CHUNKS: Readonly<{ maxWords: 16; maxChars: 84; breaks: 'sentence' }>;

/** 3661.25 → "01:01:01,250" (SRT), or with sep '.' WebVTT's "01:01:01.250"; never below 0. */
export function stamp(seconds: number, sep?: string): string;
/** A cue a caption file can write: its time, and its text or its words. */
export type FileCue = { start: number; end: number } & ({ text: string } | { words: readonly { text: string }[] });
/** A WebVTT or SRT file: numbered cues moved by `offset`, cut to [from, to], wrapped onto two lines past `lineChars`; no cue arrow in a text; WebVTT's & < > escaped. */
export function captionFile(cues: readonly FileCue[], kind?: 'vtt' | 'srt', options?: { offset?: number; from?: number; to?: number; lineChars?: number }): string;
/** A caption file's cues (WebVTT or SRT; a cue's lines joined by a space; WebVTT's escapes read). */
export function readCaptions(text: string): { start: number; end: number; text: string }[];

// ── chapters ────────────────────────────────────────────────────────────────────────────────────────────────

/** 0 → "0:00", 95.9 → "1:35", 3725 → "1:02:05": a chapter's time as YouTube reads it. */
export function clockText(seconds: number): string;
/** A chapter mark: where it starts (seconds) and its title. */
export interface ChapterMark { at: number; title: string }
/** Chapter lines ("1:05 The middle") back to marks; a line that is not one is skipped. */
export function readChapters(text: string): ChapterMark[];
/** What youtubeChapters did to a mark. */
export type ChapterChange =
  | { kind: 'moved'; title: string; at: number; to: 0 }
  | { kind: 'replaced'; title: string; at: number; by: string }
  | { kind: 'merged'; title: string; at: number; into: string }
  | { kind: 'dropped'; title: string; at: number };
/** YouTube chapters: the lines to paste, them joined, the chapters kept, what was fixed, and what could not be. */
export interface Chapters { lines: string[]; text: string; kept: ChapterMark[]; changes: ChapterChange[]; problems: string[] }
/** YouTube chapters by YouTube's rules (first at 0:00, at least three, each `min` s or more), fixing what it can and saying what it did. */
export function youtubeChapters(marks: readonly ChapterMark[], options?: { length?: number; min?: number }): Chapters;
