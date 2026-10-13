// The decoded take, read back as samples: a 16-bit mono PCM WAV — the one shape trim.js · decodeArgs makes of every
// recording (WAV or M4A) before its silences are measured, so this reader knows that shape and refuses any other.
import { readFileSync } from 'node:fs';

const PCM = 1, EXTENSIBLE = 0xfffe;   // a WAV's format tags for plain integer samples

/** A 16-bit mono PCM WAV → { rate, samples (Int16Array) }. Anything else is refused, naming what it is. */
export function readWav(file) {
  const buf = readFileSync(file);
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a WAV file`);
  let fmt = null;
  for (let at = 12; at + 8 <= buf.length;) {
    const id = buf.toString('ascii', at, at + 4), size = buf.readUInt32LE(at + 4), body = at + 8;
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') return { rate: pcm16(fmt, file).rate, samples: samplesOf(buf, body, Math.min(size, buf.length - body)) };
    at = body + size + (size % 2);   // a chunk of odd size is padded to an even one
  }
  throw new Error(`${file} has no audio data`);
}

/** The format, when it is 16-bit mono PCM; refused otherwise. */
function pcm16(fmt, file) {
  if (!fmt || (fmt.tag !== PCM && fmt.tag !== EXTENSIBLE) || fmt.bits !== 16 || fmt.channels !== 1) {
    throw new Error(`${file} is not 16-bit mono PCM (${fmt ? `${fmt.channels} channel(s), ${fmt.bits}-bit, format ${fmt.tag}` : 'no format before its data'}): decode it first (trim.js · decodeArgs)`);
  }
  return fmt;
}

/** `bytes` of little-endian 16-bit samples from `at`, as an Int16Array (a trailing odd byte is dropped). */
function samplesOf(buf, at, bytes) {
  const samples = new Int16Array(Math.floor(bytes / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(at + 2 * i);
  return samples;
}
