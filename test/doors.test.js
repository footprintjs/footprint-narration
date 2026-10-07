// The two doors. The pure door ('footprint-narration') runs in a browser: nothing it reaches may import a Node
// module, or every React project that bundles it breaks. The voice door ('footprint-narration/voice') is Node only.
// Every public symbol has ONE door, and the hand-kept types declare every symbol their door hands out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// every way a module names another: import/export … from '…', a bare import '…', and import('…')
const specifiers = (file) => [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? m[2] ?? m[3]);

/** Every file a door reaches, and every specifier each one imports. */
function reach(door) {
  const seen = new Map(), todo = [path.join(root, door)];
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    const specs = specifiers(file);
    seen.set(file, specs);
    for (const s of specs) if (s.startsWith('.')) todo.push(path.resolve(path.dirname(file), s));
  }
  return seen;
}

const NODE = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const relative = (file) => path.relative(root, file);

test('the pure door reaches no Node module and no package: it runs in a browser', () => {
  for (const [file, specs] of reach('index.js')) {
    for (const s of specs) {
      assert.ok(!NODE.has(s) && !s.startsWith('node:'), `${relative(file)} imports ${s}: the pure door must run in a browser`);
      assert.ok(s.startsWith('.'), `${relative(file)} imports the package ${s}: footprint-narration has no dependencies`);
    }
  }
});

test('every source file is behind exactly one door, and only the voice door reaches src/voice', () => {
  const pure = [...reach('index.js').keys()].map(relative), voice = [...reach('voice.js').keys()].map(relative);
  assert.ok(pure.every((f) => !f.startsWith('src/voice/')), 'src/voice is Node only');
  const files = ['spoken', 'sentences', 'captions', 'chapters', 'voice'].flatMap((d) => readdirSync(path.join(root, 'src', d)).filter((f) => f.endsWith('.js')).map((f) => `src/${d}/${f}`));
  for (const f of files) assert.ok(pure.includes(f) || voice.includes(f), `${f} is behind no door`);
  for (const f of voice.filter((v) => v.startsWith('src/') && !v.startsWith('src/voice/'))) assert.ok(pure.includes(f), `${f}: a pure file the voice door uses is pure, behind the pure door too`);
});

test('every public symbol has one door, and its types declare it', async () => {
  const doors = { 'index.js': Object.keys(await import('../index.js')), 'voice.js': Object.keys(await import('../voice.js')) };
  const both = doors['index.js'].filter((name) => doors['voice.js'].includes(name));
  assert.deepEqual(both, [], 'a symbol with two doors');
  for (const [door, names] of Object.entries(doors)) {
    const types = readFileSync(path.join(root, door.replace(/\.js$/, '.d.ts')), 'utf8');
    for (const name of names) assert.match(types, new RegExp(`export (?:declare )?(?:function|const) ${name}\\b`), `${door.replace(/\.js$/, '.d.ts')} does not declare ${name}`);
  }
});
