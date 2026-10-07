// Numbers in words. A forced aligner knows letters only, and a voice drops or garbles digits, so every number a
// voice says is said in words.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];

/** The largest number said as a number; a longer run of digits is said digit by digit (digitWords). */
export const MAX_NUMBER = 999_999_999_999_999;

/** A whole number (0 to 999 999 999 999 999) in words: 42 → "forty-two", 2026 → "two thousand twenty-six". */
export function numberWords(n) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_NUMBER) throw new RangeError(`numberWords takes a whole number from 0 to ${MAX_NUMBER}, not ${n}`);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberWords(n % 100) : '');
  const [size, name] = SCALES.find(([s]) => n >= s);
  return numberWords(Math.floor(n / size)) + ` ${name}` + (n % size ? ' ' + numberWords(n % size) : '');
}

/** A run of digits as a voice says it: as a number ("007" → "seven"), or, past MAX_NUMBER, digit by digit. */
export const digitWords = (digits) => (digits.replace(/^0+(?=\d)/, '').length > 15
  ? [...digits].map((d) => ONES[d]).join(' ')
  : numberWords(Number(digits)));
