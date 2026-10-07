// YouTube chapters — ONE rule, footprint-storyreel 0.9.0's (targets/youtube.mjs · youtubeChapters: fix what can be
// fixed), now also saying what it did (StoryDeck 0.2.0's narration.js · chapterList only reported); with the clock
// that writes a chapter's time and the parser that reads the lines back (release.mjs · chapterOf).

const pad = (n) => String(n).padStart(2, '0');

/** 0 → "0:00", 95.9 → "1:35", 3725 → "1:02:05" — a chapter's time as YouTube reads it. */
export function clockText(seconds) {
  const t = Math.floor(seconds), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Chapter lines ("1:05 The middle", one per line) back to marks [{ at, title }]; a line that is not one is skipped. */
export function readChapters(text) {
  return String(text).split('\n').map((line) => /^(\d+(?::\d{1,2}){1,2})\s+(\S.*)$/.exec(line.trim())).filter(Boolean)
    .map(([, time, title]) => ({ at: time.split(':').reduce((s, part) => s * 60 + Number(part), 0), title }));
}

function checkMark(m, i) {
  const title = typeof m?.title === 'string' ? m.title.replace(/\s+/g, ' ').trim() : '';
  if (!(Number.isFinite(m?.at) && m.at >= 0) || !title) throw new TypeError(`youtubeChapters: marks[${i}] must be { at: seconds (0 or more), title: words }, not ${JSON.stringify(m)}`);
  return { at: m.at, title };
}

/**
 * YouTube chapters from marks ([{ at: seconds, title }], in any order) by YouTube's rules — the first at 0:00, at
 * least three, each at least `min` (10) seconds long — fixing what it can and saying what it did:
 *   the first mark is MOVED to 0:00;
 *   a mark less than `min` after the chapter before it is MERGED into that chapter (its title stays) — except in
 *     the first `min` seconds, where it REPLACES the first chapter (an opening card shorter than 10 s is not a
 *     chapter: the real first chapter takes 0:00);
 *   a last chapter shorter than `min` before the video's `length` is DROPPED (as is any mark past its end).
 * Returns { lines, text, kept, changes, problems }: the lines to paste ("1:35 The end"; none when fewer than three
 * stand), them joined, the chapters kept ({ at, title }), each mark it moved, replaced, merged or dropped
 * ({ kind, title, at } and `to`, `by` or `into`) — every mark is kept as it is, or named once in `changes` — and
 * what it could not fix.
 */
export function youtubeChapters(marks, { length, min = 10 } = {}) {
  if (!Array.isArray(marks)) throw new TypeError('youtubeChapters: marks must be a list of { at: seconds, title }');
  if (!(Number.isFinite(min) && min > 0)) throw new RangeError(`youtubeChapters: min must be seconds, more than 0, not ${JSON.stringify(min)}`);
  if (length !== undefined && !(Number.isFinite(length) && length >= 0)) throw new RangeError(`youtubeChapters: length must be the video's seconds, not ${JSON.stringify(length)}`);
  const kept = [], changes = [];
  let opening = null;   // the change that moved the first chapter to 0:00, while it is the first
  for (const m of marks.map(checkMark).sort((a, b) => a.at - b.at)) {
    if (!kept.length || (kept.length === 1 && m.at < min)) {
      if (kept.length) {   // the first chapter yields its place to this one
        const replaced = { kind: 'replaced', title: kept[0].title, at: opening ? opening.at : 0, by: m.title };
        if (opening) changes.splice(changes.indexOf(opening), 1, replaced); else changes.push(replaced);
      }
      kept[0] = { at: 0, title: m.title };
      opening = m.at > 0 ? { kind: 'moved', title: m.title, at: m.at, to: 0 } : null;
      if (opening) changes.push(opening);
      continue;
    }
    const before = kept.at(-1);
    if (m.at - before.at < min) changes.push({ kind: 'merged', title: m.title, at: m.at, into: before.title });
    else kept.push({ at: m.at, title: m.title });
  }
  while (length !== undefined && kept.length && length - kept.at(-1).at < min) {   // (more than once only for marks past the end)
    const last = kept.pop(), dropped = { kind: 'dropped', title: last.title, at: !kept.length && opening ? opening.at : last.at };
    if (!kept.length && opening) changes.splice(changes.indexOf(opening), 1, dropped); else changes.push(dropped);
  }
  const lines = kept.length >= 3 ? kept.map((k) => `${clockText(k.at)} ${k.title}`) : [];
  return { lines, text: lines.join('\n'), kept, changes, problems: kept.length >= 3 ? [] : ['YouTube shows chapters only when there are at least three'] };
}
