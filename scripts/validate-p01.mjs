import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const required = [
  'README.md',
  'docs/PROJECT-BRIEF.md',
  'docs/ART-DIRECTION.md',
  'docs/SIMULATION-CONTRACT.md',
  'docs/ENVIRONMENT-CONTRACT.md',
  'docs/DECISIONS.md',
  'docs/REFERENCE-ATLAS.md',
  'docs/HOME-APPROVAL-CHECKLIST.md',
  'assets/reference/spectral-homestead-reference-atlas.png'
];

const failures = [];
const pass = (message) => console.log(`✓ ${message}`);
const fail = (message) => failures.push(message);

for (const relativePath of required) {
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath)) {
    fail(`Missing required file: ${relativePath}`);
    continue;
  }
  if (statSync(absolutePath).size === 0) {
    fail(`Required file is empty: ${relativePath}`);
    continue;
  }
  pass(`Found ${relativePath}`);
}

const requiredTerms = new Map([
  ['docs/PROJECT-BRIEF.md', ['Home vertical-slice boundary', 'Forest gate', 'Pond gate', 'Non-goals']],
  ['docs/ART-DIRECTION.md', ['Porcelain Spectrum', 'Technical Wire', 'Ghost Volume', 'prohibited drift', 'Motion Look']],
  ['docs/SIMULATION-CONTRACT.md', ['Neural Cellular Automata', 'per-organism', 'float32[24]', 'Food and kill are applied independently', 'Determinism']],
  ['docs/ENVIRONMENT-CONTRACT.md', ['Signed effect semantics', 'F = 1 - product', 'K = 1 - product', 'home-motion-look']],
  ['docs/DECISIONS.md', ['Accepted — P02', 'Creative owner', 'Implementation owner']],
  ['docs/HOME-APPROVAL-CHECKLIST.md', ['Uncaptioned readability test', 'Gate C passes']]
]);

for (const [relativePath, terms] of requiredTerms) {
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath)) continue;
  const content = readFileSync(absolutePath, 'utf8');
  for (const term of terms) {
    if (!content.includes(term)) fail(`${relativePath} is missing governing term: ${term}`);
  }
}

const markdownFiles = required.filter((file) => extname(file) === '.md');
const linkPattern = /!?(?:\[[^\]]*\])\(([^)]+)\)/g;
for (const relativePath of markdownFiles) {
  const content = readFileSync(resolve(root, relativePath), 'utf8');
  for (const match of content.matchAll(linkPattern)) {
    const target = match[1].trim();
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const cleanTarget = target.split('#')[0].split('?')[0];
    if (!cleanTarget) continue;
    const absoluteTarget = resolve(root, dirname(relativePath), cleanTarget);
    if (!existsSync(absoluteTarget)) fail(`Broken local link in ${relativePath}: ${target}`);
  }
}
pass('Checked local Markdown links');

const atlasPath = resolve(root, 'assets/reference/spectral-homestead-reference-atlas.png');
if (existsSync(atlasPath)) {
  const png = readFileSync(atlasPath);
  const signature = '89504e470d0a1a0a';
  if (png.subarray(0, 8).toString('hex') !== signature) {
    fail('Reference atlas is not a valid PNG');
  } else {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (width < 1500 || height < 1000) fail(`Reference atlas is too small: ${width}×${height}`);
    else pass(`Reference atlas is ${width}×${height}`);
  }
}

if (failures.length > 0) {
  console.error('\nP01 validation failed:');
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log('\nP01 specification package is structurally valid.');
