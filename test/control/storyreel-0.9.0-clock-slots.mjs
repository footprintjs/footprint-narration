/**
 * The lesson clock: one timeline from the paced narration timings. A beat names what is SAID
 * ({scene, phrase}); the clock turns it into seconds on the whole-lesson timeline. A phrase the
 * narration does not contain refuses the recipe (no silent fallback to a guessed time). A silent
 * scene's directions are its "narration" here: a beat names a direction the way it names a phrase,
 * and the directions are never spoken (clock.mjs · directionTimings).
 */
/** Letters and digits only, lower case: how narration text and spoken words are compared. */
// (Letters, their combining marks and digits: a Tamil or Telugu vowel sign is part of the word — கடை is not கட.)
export const normSpeech = text => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');

/** How long one direction may last, in seconds: long enough to see, short enough to stay a beat. */
export const DIRECTION_SECONDS = Object.freeze([.2, 20]);

/**
 * A storyboard scene is spoken (`narration`: what is said) or silent (`silent`: directions, each
 * [text, seconds]), never both: a direction inside a spoken scene waits for the shared beat (design
 * section 10). Anything else refuses, naming the fix. Returns 'spoken' or 'silent'.
 */
export function checkScene(scene, i = 0) {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) throw new TypeError(`storyboard scene ${i} must be an object: {"id", "narration"} or {"id", "silent": [["a direction", seconds], …]}`);
  const name = `storyboard scene ${scene.id ?? i}`, spoken = scene.narration !== undefined, silent = scene.silent !== undefined;
  if (spoken && silent) throw new Error(`${name} has both narration and silent: a scene is spoken or silent, not both (directions inside a spoken scene are not supported yet); move the directions into a silent scene of their own`);
  if (!spoken && !silent) throw new Error(`${name} has no narration and no silent: give "narration": "what is said", or "silent": [["the door opens", 1.0], …]`);
  if (scene.speaker !== undefined && !(typeof scene.speaker === 'string' && scene.speaker.trim())) throw new TypeError(`${name}: speaker must name who says the scene (a word, e.g. "robot"), not ${JSON.stringify(scene.speaker)}`);
  if (spoken) {
    if (typeof scene.narration !== 'string') throw new TypeError(`${name}: narration must be the words said, as one string`);
    if (scene.say !== undefined) checkSay(scene, name);
    return 'spoken';
  }
  if (scene.say !== undefined) throw new Error(`${name}: say is for a spoken scene (what the voice says for a word the captions show); a silent scene says nothing`);
  if (!Array.isArray(scene.silent) || !scene.silent.length) throw new TypeError(`${name}: silent must list its directions, e.g. "silent": [["the door opens", 1.0]]`);
  const [lo, hi] = DIRECTION_SECONDS;
  scene.silent.forEach((direction, k) => {
    if (!Array.isArray(direction) || direction.length !== 2) throw new TypeError(`${name}: silent[${k}] must be [text, seconds], e.g. ["the door opens", 1.0], not ${JSON.stringify(direction)}`);
    const [text, seconds] = direction;
    if (typeof text !== 'string' || !normSpeech(text)) throw new TypeError(`${name}: silent[${k}] must start with the direction's words (letters or digits), not ${JSON.stringify(text)}`);
    if (typeof seconds !== 'number' || !(seconds >= lo && seconds <= hi)) throw new RangeError(`${name}: silent[${k}] "${text}" must last ${lo}..${hi} seconds, not ${JSON.stringify(seconds)}`);
  });
  return 'silent';
}

/**
 * Number slots: `say: [[shown, spoken], …]` — the captions show `shown` ("16.67 ms"), the voice says
 * `spoken` ("sixteen point six seven milliseconds"). A voice drops or garbles digits, so a number is
 * written for the voice in words and shown on screen in digits. Each `shown` must appear in the
 * narration, in order; `spoken` is words only (no digits — that is the point).
 */
export function checkSay(scene, name) {
  if (!Array.isArray(scene.say) || !scene.say.length) throw new TypeError(`${name}: say must list pairs [shown, spoken], e.g. "say": [["16.67 ms", "sixteen point six seven milliseconds"]]`);
  let from = 0;
  scene.say.forEach((pair, k) => {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(x => typeof x === 'string' && normSpeech(x))) throw new TypeError(`${name}: say[${k}] must be [shown, spoken], two strings with words, not ${JSON.stringify(pair)}`);
    const [shown, said] = pair;
    if (/[0-9]/.test(said)) throw new Error(`${name}: say[${k}] "${said}" has digits; say it in words (a voice drops or garbles digits)`);
    const at = findSlot(scene.narration, shown, from);
    if (at < 0) throw new Error(`${name}: say[${k}] shows "${shown}", which the narration does not have as a whole${from ? ' after the slot before it' : ''} (not inside a longer number or word); each shown text must appear in the narration, in order`);
    from = at + shown.length;
  });
}

/**
 * Where a slot's shown text is in the narration, from `from`: the first place it stands whole — not inside
 * a longer number or word ("2" is not in "12", "B2" or "2012") — or -1.
 */
export function findSlot(text, shown, from = 0) {
  const word = /[\p{L}\p{N}]/u, joinsLeft = word.test(shown[0]), joinsRight = word.test(shown.at(-1));
  for (let at = text.indexOf(shown, from); at >= 0; at = text.indexOf(shown, at + 1)) {
    if (joinsLeft && at > 0 && word.test(text[at - 1])) continue;
    if (joinsRight && at + shown.length < text.length && word.test(text[at + shown.length])) continue;
    return at;
  }
  return -1;
}

/**
 * A spoken scene's narration in pieces: the text between slots, and each slot where it sits — found the
 * way checkSay finds them (each shown text, in order, after the one before). A slot is a POSITION: a
 * shown text written again elsewhere in the narration is not a slot there.
 */
export function slotPieces(scene) {
  const pieces = [], text = scene.narration; let from = 0;
  for (const [shown, said] of scene.say ?? []) {
    const at = findSlot(text, shown, from);
    if (at < 0) break;
    pieces.push({text: text.slice(from, at)}, {shown, said});
    from = at + shown.length;
  }
  pieces.push({text: text.slice(from)});
  return pieces;
}

/** What the voice says for a scene: its narration with each number slot's spoken words in place of what is shown. */
export function spokenText(scene) {
  if (!scene.say) return scene.narration;
  return slotPieces(scene).map(p => p.text ?? p.said).join('');
}

/**
 * The scene's slots in letters-and-digits offsets (normSpeech): `shown` is the narration as written,
 * and each piece maps its range there [n0, n1) to its range in the spoken text [s0, s1) — so a phrase
 * written with the digits finds the same words as one written as the voice says it.
 */
export function slotMap(scene) {
  if (!scene?.say || scene.narration === undefined) return null;
  let shown = '', n = 0, s = 0; const map = [];
  for (const p of slotPieces(scene)) {
    const written = normSpeech(p.text ?? p.shown), spoken = normSpeech(p.text ?? p.said);
    map.push({n0: n, n1: n + written.length, s0: s, s1: s + spoken.length, slot: p.shown ?? null});
    shown += written; n += written.length; s += spoken.length;
  }
  return {shown, map};
}
/** A letters-and-digits offset in the narration as written, in the spoken text; inside a slot it snaps to the slot's edge (a phrase that covers part of a slot covers all of it). */
export function spokenOffset(map, at, end) {
  for (const m of map) if (at >= m.n0 && at <= m.n1) return !m.slot ? m.s0 + (at - m.n0) : at === m.n0 ? m.s0 : at === m.n1 ? m.s1 : end ? m.s1 : m.s0;
  return null;
}

/** Where in `raw` its n-th letter or digit starts (raw.length past the last). */
export function letterStart(raw, n) {
  let count = 0, at = 0;
  for (const ch of raw) { const k = normSpeech(ch).length; if (k && count >= n) return at; count += k; at += ch.length; }
  return raw.length;
}
/** Where in `raw` its n-th letter or digit ends (n counted from 1; the punctuation after it is not included). */
export function letterEnd(raw, n) {
  let count = 0, at = 0;
  for (const ch of raw) { at += ch.length; count += normSpeech(ch).length; if (count >= n) return at; }
  return raw.length;
}

/**
 * The words to show for a scene: its timed words, with each number slot's spoken run collapsed back into
 * what is shown where the slot IS ("sixteen point six seven milliseconds." → "16.67 ms."), timed from the
 * run's first word to its last — so captions show digits while the voice said words. Punctuation around
 * the run stays ("(" … ")"), a slot joined to a word keeps the word ("three-pebble" → "3-pebble"), and two
 * slots in one word are both shown ("three-four" → "3-4"). Words that do not spell the scene as spoken are
 * returned as they are.
 */
export function shownWords(scene, words) {
  const slots = slotMap(scene);
  if (!slots) return words;
  let at = 0;
  const ranged = words.map(w => { const n = normSpeech(w.text).length, r = {w, from: at, to: at + n}; at += n; return r; });
  if (at !== normSpeech(spokenText(scene)).length) return words;
  // Units: the words each slot touches become one; slots that touch the same word share it.
  const unitOf = ranged.map((_, i) => i), find = i => (unitOf[i] === i ? i : (unitOf[i] = find(unitOf[i])));
  const slotsIn = new Map();
  for (const m of slots.map.filter(p => p.slot)) {
    const touched = ranged.map((r, i) => ((r.to > m.s0 && r.from < m.s1) || (r.from === r.to && r.from > m.s0 && r.from < m.s1) ? i : -1)).filter(i => i >= 0);
    if (!touched.length) continue;
    for (const i of touched) unitOf[find(i)] = find(touched[0]);
    const root = find(touched[0]);
    slotsIn.set(root, [...(slotsIn.get(root) ?? []), m]);
  }
  for (const [root, list] of [...slotsIn]) { const r = find(root); if (r !== root) { slotsIn.set(r, [...(slotsIn.get(r) ?? []), ...list]); slotsIn.delete(root); } }
  const out = [];
  for (let i = 0; i < ranged.length;) {
    const root = find(i); let j = i; while (j + 1 < ranged.length && find(j + 1) === root) j++;
    const list = slotsIn.get(root);
    if (!list) { out.push(ranged[i].w); i = j + 1; continue; }
    // The unit's text, each slot's run replaced by what is shown — the last first, so the earlier places hold.
    let text = ranged.slice(i, j + 1).map(r => String(r.w.text)).join(' '); const base = ranged[i].from;
    for (const m of [...list].sort((a, b) => b.s0 - a.s0)) text = text.slice(0, letterStart(text, m.s0 - base)) + m.slot + text.slice(letterEnd(text, m.s1 - base));
    out.push({text, start: ranged[i].w.start, end: ranged[j].w.end});
    i = j + 1;
  }
  return out;
}

/**
 * Numbers in the narration the voice would have to read as digits: [{scene, text}] — every run of digits
 * not in a number slot (a slot is a position: the same digits written again elsewhere are not said).
 * A voice tool can refuse these before it speaks (a voice drops or garbles digits); write them as `say` slots.
 */
export function unsaidNumbers(storyboard) {
  const out = [];
  for (const scene of storyboard.scenes) {
    if (scene.narration === undefined) continue;
    const text = slotPieces(scene).map(p => p.text ?? ' ').join('');   // a slot's place blanked: its digits are said
    for (const m of text.matchAll(/[0-9][0-9.,:]*/g)) out.push({scene: scene.id, text: m[0].replace(/[.,:]+$/, '')});
  }
  return out;
}

/** A scene's text, checked (clock.mjs · checkScene): what its words spell — the narration as spoken (number slots in words), or its directions joined. */
export const sceneText = (scene, i) => checkScene(scene, i) === 'silent' ? scene.silent.map(([text]) => text).join(' ') : spokenText(scene);
