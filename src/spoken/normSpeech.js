/**
 * Letters, their combining marks and digits only, NFKC, lower case: how two spellings of what is said are
 * COMPARED ("are these the same words?"). A Tamil or Telugu vowel sign is part of the word — கடை is not கட.
 * (Where a word ENDS, for a substitution, is a different question: see rules.js · EDGE.)
 */
export const normSpeech = (text) => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
