// Compiled, never run (CI: tsc --noEmit): the hand-kept types describe the doors as a caller uses them.
import { spokenMap, autoRules, shownWords, spokenOffset, unsaidDigits, checkSlots, captionChunks, captionCues, captionFile, readCaptions, captionAt,
  FILE_CHUNKS, youtubeChapters, readChapters, clockText, sentences, saidSentences, sentenceStarts, numberWords, normSpeech, SPELL, SAY, findSlot, stamp } from 'footprint-narration';
import type { SpokenMap, Piece, Rules, Slot, WordTiming, Track, WordCue, Chapters, ChapterChange } from 'footprint-narration';
import { clipKey, clipFor, voiceClips, pickSteps, chatterboxKit } from 'footprint-narration/voice';
import type { VoiceEngine, Clip, VoiceProfile } from 'footprint-narration/voice';

const slots: Slot[] = [['16.67 ms', 'sixteen point six seven milliseconds']];
const map: SpokenMap = spokenMap('One frame takes 16.67 ms.', { slots: checkSlots('One frame takes 16.67 ms.', slots), rules: autoRules({ spell: { ...SPELL, UI: 'U I' }, say: SAY }) });
const kinds: Piece['kind'][] = map.pieces.map((p) => p.kind);
const shout: Rules = { name: 'shout', apply: (pieces) => pieces.map((p) => (p.kind === 'text' ? { ...p, spoken: p.spoken.toUpperCase() } : p)) };
const words: WordTiming[] = [{ text: 'One', start: 0, end: 0.3 }];
const shown: WordTiming[] = shownWords(map, words);
const at: number | null = spokenOffset(spokenMap('x', { rules: shout }), 0, { end: true });
const digits: string[] = unsaidDigits(map);
const tracks: Track[] = [{ offset: 0, duration: 2, words }];
const chunks: WordCue[] = captionChunks(tracks, FILE_CHUNKS);
const now = captionAt(chunks, 0.1)?.active;
const vtt: string = captionFile(chunks, 'vtt', { offset: 1, lineChars: Infinity }) + captionFile(captionCues([{ start: 0, written: 'A.', spoken: 'A.', clip: { duration: 1, sentences: [0] } }]), 'srt');
const back: { start: number; end: number; text: string }[] = readCaptions(vtt);
const list: Chapters = youtubeChapters(readChapters('0:00 Intro'), { length: 60 });
const change: ChapterChange | undefined = list.changes[0];
if (change?.kind === 'merged') change.into.toUpperCase();
const misc: (string | number | string[] | number[])[] = [clockText(95), sentences('A. B.'), saidSentences(null), sentenceStarts('A.', [{ start: 0 }]), numberWords(42), normSpeech('É'), findSlot('a 2', '2'), stamp(1, '.')];

const profile: VoiceProfile = { id: 'me', seed: 7 };
const engine: VoiceEngine = chatterboxKit({ kit: '../kit', run: () => ({ status: 0 }) });
const clip: Clip | null = clipFor('Hi.', { cache: 'cache', profile });
const timed: WordTiming[] | null | undefined = clip?.words;
const key: string = clipKey('Hi.', profile);
voiceClips(['Hi.'], { cache: 'cache', profile, engine, only: pickSteps('1-3'), batch: 2 }).then((r) => r.voiced + r.todo + r.wanted);

export { kinds, shown, at, digits, now, back, misc, timed, key };
