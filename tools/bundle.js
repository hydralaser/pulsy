// Bundles each page and its ES modules into single self-contained HTML files:
//   dist/pulsy.html, dist/village.html      - full pages; open by double-clicking, no server needed
//   dist/pulsy-artifact.html, dist/village-artifact.html - the same pages without the document
//                                             wrapper, for publishing
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  {
    page: 'index.html',
    entry: 'src/ui/app.js',
    out: 'pulsy',
    modules: [
  'src/sim/rng.js',
  'src/sim/rules.js',
  'src/sim/names.js',
  'src/sim/core.js',
  'src/sim/soldier.js',
  'src/sim/unit.js',
  'src/sim/woundtables.js',
  'src/sim/wounds.js',
  'src/sim/combat.js',
  'src/sim/resolve.js',
  'src/sim/nerve.js',
  'src/sim/light.js',
  'src/sim/horse.js',
  'src/sim/ai.js',
  'src/sim/world.js',
  'src/sim/record.js',
  'src/render/draw.js',
  'src/ui/app.js',
],
  },
  {
    page: 'village.html',
    entry: 'src/village/app.js',
    out: 'village',
    modules: [
      'src/sim/rules.js',
      'src/sim/core.js',
      'src/sim/names.js',
      'src/village/rules.js',
      'src/village/names.js',
      'src/village/clock.js',
      'src/village/people.js',
      'src/village/land.js',
      'src/village/economy.js',
      'src/village/building.js',
      'src/village/family.js',
      'src/village/council.js',
      'src/village/work.js',
      'src/village/life.js',
      'src/village/village.js',
      'src/village/draw.js',
      'src/village/app.js',
    ],
  },
];

function build({ page, entry, out, modules }) {
  const seen = new Map();
  const parts = modules.map((path) => {
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

  const html = readFileSync(join(root, page), 'utf8');
  const scriptTag = `<script type="module" src="${entry}"></script>`;
  if (!html.includes(scriptTag)) throw new Error(`${page}: app script tag not found`);
  const full = html.replace(scriptTag, () => `<script>\n${js}\n</script>`);

  const head = full.slice(full.indexOf('<title>'), full.indexOf('</head>'));
  const body = full.slice(full.indexOf('<body>') + '<body>'.length, full.indexOf('</body>'));

  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, `dist/${out}.html`), full);
  writeFileSync(join(root, `dist/${out}-artifact.html`), `${head}${body}`);
  console.log(`${out}: bundled ${modules.length} modules (${(js.length / 1024).toFixed(0)} KB of script).`);
}

for (const target of TARGETS) build(target);
