/** A caption file's cues: [{start, end, text}] (WebVTT or SRT). */
export function readCaptions(text) {
  const time = s => { const p = s.trim().replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  return String(text).replace(/\r/g, '').split(/\n{2,}/).map(block => {
    const lines = block.split('\n'), at = lines.findIndex(l => l.includes('-->'));
    if (at < 0) return null;
    const [a, b] = lines[at].split('-->');
    return {start: time(a), end: time(b.trim().split(/\s+/)[0]), text: lines.slice(at + 1).join(' ').trim()};
  }).filter(Boolean);
}
