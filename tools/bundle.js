// Bundles index.html and the ES modules into single self-contained HTML files:
//   dist/pulsy.html        - full page; open by double-clicking, no server needed
//   dist/pulsy-artifact.html - the same page without the document wrapper, for publishing
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = [
  'src/sim/rng.js',
  'src/sim/rules.js',
  'src/sim/names.js',
  'src/sim/core.js',
  'src/sim/soldier.js',
  'src/sim/unit.js',
  'src/sim/combat.js',
  'src/sim/nerve.js',
  'src/sim/ai.js',
  'src/sim/world.js',
  'src/render/draw.js',
  'src/ui/app.js',
];

const seen = new Map();
const parts = MODULES.map((path) => {
  let src = readFileSync(join(root, path), 'utf8');
  src = src.replace(/^import [^;]*?from '[^']+';\n/gm, '');
  src = src.replace(/^export (?=(async )?function|const|let|class)/gm, '');
  if (/^(import|export) /m.test(src)) throw new Error(`${path}: unsupported import/export form`);
  for (const m of src.matchAll(/^(?:async )?(?:function|const|let|class) (\w+)/gm)) {
    if (seen.has(m[1])) throw new Error(`"${m[1]}" is declared in both ${seen.get(m[1])} and ${path}`);
    seen.set(m[1], path);
  }
  return `// ---- ${path} ----\n${src}`;
});
const js = `(() => {\n'use strict';\n${parts.join('\n')}\n})();`;

const html = readFileSync(join(root, 'index.html'), 'utf8');
const scriptTag = '<script type="module" src="src/ui/app.js"></script>';
if (!html.includes(scriptTag)) throw new Error('index.html: app script tag not found');
const full = html.replace(scriptTag, () => `<script>\n${js}\n</script>`);

const head = full.slice(full.indexOf('<title>'), full.indexOf('</head>'));
const body = full.slice(full.indexOf('<body>') + '<body>'.length, full.indexOf('</body>'));

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/pulsy.html'), full);
writeFileSync(join(root, 'dist/pulsy-artifact.html'), `${head}${body}`);
console.log(`Bundled ${MODULES.length} modules (${(js.length / 1024).toFixed(0)} KB of script).`);
