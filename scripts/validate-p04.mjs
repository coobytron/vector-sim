import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];
const required = [
  'src/organisms/types.ts',
  'src/organisms/morphology.ts',
  'src/organisms/visualState.ts',
  'src/organisms/captureRoute.ts',
  'src/rendering/vectorBufferPacker.ts',
  'src/rendering/vectorRenderer.ts',
  'tests/morphology.test.ts',
  'tests/organismVisualState.test.ts',
  'tests/captureRoute.test.ts',
  'scripts/generate-organism-reference.ts',
  'docs/P04-VECTOR-AGENTS.md',
  'benchmark-results/p04-node-reference-2026-08-07.json',
  'assets/reference/organism-morphology-reference.png',
  'assets/reference/organism-state-reference.png',
  'assets/reference/organism-reference.json',
];

for (const path of required) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) failures.push(`Missing P04 file: ${path}`);
  else if (statSync(absolute).size === 0) failures.push(`Empty P04 file: ${path}`);
}

const read = (path) => readFileSync(resolve(root, path), 'utf8');
const morphology = read('src/organisms/morphology.ts');
for (const term of [
  "'branching'",
  "'ribbon'",
  "'radial'",
  'stableOrganismId',
  'selectMorphologyLod',
  'maximumTopologyDegree',
]) {
  if (!morphology.includes(term)) failures.push(`Morphology contract is missing: ${term}`);
}

const visual = read('src/organisms/visualState.ts');
for (const term of ['feeding', 'starving', 'damaged', 'mutating', 'dying', 'death', 'regenerating']) {
  if (!visual.includes(`'${term}'`)) failures.push(`Lifecycle decoder is missing: ${term}`);
}

const packer = read('src/rendering/vectorBufferPacker.ts');
for (const term of ['nodeWavelengths', 'edgeActivity', 'facePositions', 'stateOverride', 'lodImportanceThreshold']) {
  if (!packer.includes(term)) failures.push(`Pooled vector packer is missing: ${term}`);
}

const manifest = JSON.parse(read('assets/reference/organism-reference.json'));
if (manifest.schema !== 'vector-sim-organism-reference-v1') failures.push('Unexpected organism reference schema.');
if (manifest.width !== 1536 || manifest.height !== 1024) failures.push('Organism references must remain 1536×1024.');
for (const family of ['branching', 'ribbon', 'radial']) {
  if (!manifest.families?.includes(family)) failures.push(`Reference manifest is missing family: ${family}`);
}
for (const look of ['porcelain', 'technical', 'ghost']) {
  if (!manifest.looks?.includes(look)) failures.push(`Reference manifest is missing look: ${look}`);
}
for (const state of ['feeding', 'starving', 'damaged', 'mutating', 'dying', 'death', 'regenerating']) {
  if (!manifest.states?.includes(state)) failures.push(`Reference manifest is missing state: ${state}`);
}
for (const [file, expectedSha] of Object.entries(manifest.files ?? {})) {
  const png = readFileSync(resolve(root, 'assets/reference', file));
  if (png.readUInt32BE(16) !== 1536 || png.readUInt32BE(20) !== 1024) {
    failures.push(`${file} must remain 1536×1024.`);
  }
  const sha = createHash('sha256').update(png).digest('hex');
  if (sha !== expectedSha) failures.push(`${file} digest does not match its manifest.`);
}

const benchmark = JSON.parse(read('benchmark-results/p04-node-reference-2026-08-07.json'));
const mobile = benchmark.tiers?.find((tier) => tier.tier === 'mobile');
const desktop = benchmark.tiers?.find((tier) => tier.tier === 'desktop');
if (!mobile || mobile.pairedTickAndPackMs?.p95 > 8) failures.push('P04 mobile reference misses the 8 ms P95 budget.');
if (!desktop || desktop.pairedTickAndPackMs?.p95 > 4) failures.push('P04 desktop reference misses the 4 ms P95 budget.');

const packageJson = JSON.parse(read('package.json'));
for (const script of ['capture:organisms', 'validate:p04', 'qa']) {
  if (!packageJson.scripts?.[script]) failures.push(`Missing npm script: ${script}`);
}

const decisions = read('docs/DECISIONS.md');
if (!decisions.includes('D019 | Proposed — P04 implementation')) failures.push('P04 decision is missing from the decision log.');
const documentation = read('docs/P04-VECTOR-AGENTS.md');
for (const term of ['NCA-to-geometry decode', 'Lifecycle language', 'LOD without semantic loss', 'Deterministic capture harness']) {
  if (!documentation.includes(term)) failures.push(`P04 documentation is missing: ${term}`);
}

if (failures.length > 0) {
  console.error('\nP04 validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('P04 vector-agent visual system is structurally valid.');
