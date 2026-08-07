import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];
const required = [
  'src/fields/types.ts',
  'src/fields/shapes.ts',
  'src/fields/spatialIndex.ts',
  'src/fields/fieldSampler.ts',
  'src/fields/manifest.ts',
  'src/fields/index.ts',
  'src/environments/manifests/home.ts',
  'src/environments/manifests/forest.ts',
  'src/environments/manifests/pond.ts',
  'src/environments/manifests/index.ts',
  'src/rendering/fieldDebugScene.ts',
  'src/ui/fieldPanel.ts',
  'tests/fieldShapes.test.ts',
  'tests/fieldSampler.test.ts',
  'tests/fieldManifest.test.ts',
  'tests/fieldMetabolism.test.ts',
  'tests/fieldBudget.test.ts',
  'benchmark-results/node-field-sampling-2026-08-07.json',
  'docs/P07-FIELD-API.md',
  'docs/adr/0003-signed-field-api.md',
];

for (const path of required) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) failures.push(`Missing P07 file: ${path}`);
  else if (statSync(absolute).size === 0) failures.push(`Empty P07 file: ${path}`);
}

const read = (path) => readFileSync(resolve(root, path), 'utf8');

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

// The field API is sampled inside the headless tick, so it inherits the P02
// headless boundary: no Three.js, no DOM.
for (const scope of ['src/fields', 'src/environments/manifests']) {
  for (const path of walk(resolve(root, scope))) {
    if (!['.ts', '.json'].includes(extname(path))) continue;
    const content = readFileSync(path, 'utf8');
    // Match real global access rather than the words: an authored source may
    // legitimately be called "window-habitat".
    if (/from ['"]three|\bdocument\s*[.[]|\bwindow\s*[.[]|HTMLCanvasElement/.test(content)) {
      failures.push(`Headless boundary violation: ${path.slice(root.length + 1)}`);
    }
  }
}

const types = read('src/fields/types.ts');
for (const term of [
  "ENVIRONMENT_SCHEMA_VERSION = 'environment.v1'",
  'FIELD_BATCH_STRIDE = 18',
  'EffectChannel',
  'auxiliaryRangeMeters',
  'contactSourceIndex',
]) {
  if (!types.includes(term)) failures.push(`Field contract types are missing: ${term}`);
}

const sampler = read('src/fields/fieldSampler.ts');
for (const term of [
  'effectFalloff',
  'effectFalloffSlope',
  'MAX_FLOW_METERS_PER_SECOND = 1',
  'OBSTACLE_DISTANCE_CLAMP_METERS = 1',
  'GRADIENT_STEP_METERS = 0.01',
  'drawReserve',
  'moveSource',
  'addSource',
  'removeSource',
  'setStrength',
  'sampleBatch',
  'placeSpawn',
]) {
  if (!sampler.includes(term)) failures.push(`Field sampler is missing: ${term}`);
}
if (!sampler.includes('Math.fround')) {
  failures.push('Field accumulation must use float32 rounding.');
}
if (!/sort\(\(left, right\) =>/.test(sampler)) {
  failures.push('Field sources must be ordered by stable source ID.');
}

const shapes = read('src/fields/shapes.ts');
for (const kind of ['point', 'sphere', 'box', 'capsule', 'plane', 'mesh']) {
  if (!shapes.includes(`case '${kind}'`)) failures.push(`Field geometry adapter is missing: ${kind}`);
}

const manifest = read('src/fields/manifest.ts');
for (const term of [
  'SPAWN_CLEARANCE_METERS = 0.2',
  'SPAWN_MAX_KILL = 0.05',
  'SPAWN_MAX_FOOD = 0.1',
  'Duplicate stable ID',
  'Unsupported manifest version',
  'valid sha256 checksum',
  'safe framing bounds',
  'fallback input',
]) {
  if (!manifest.includes(term)) failures.push(`Manifest validation is missing: ${term}`);
}

for (const environment of ['home', 'forest', 'pond']) {
  const source = read(`src/environments/manifests/${environment}.ts`);
  if (!source.includes("schemaVersion: 'environment.v1'")) {
    failures.push(`${environment} manifest must declare environment.v1.`);
  }
  for (const look of ['porcelain-spectrum', 'technical-wire', 'ghost-volume']) {
    if (!source.includes(look)) failures.push(`${environment} manifest is missing look ${look}.`);
  }
}

const benchmark = JSON.parse(read('benchmark-results/node-field-sampling-2026-08-07.json'));
if (benchmark.schema !== 'vector-sim-node-benchmark-v1') {
  failures.push('Unexpected field benchmark schema.');
}
for (const tier of benchmark.tiers ?? []) {
  if (typeof tier.fieldSampleMs?.p95 !== 'number') {
    failures.push(`Field benchmark tier ${tier.tier} is missing a field sampling P95.`);
    continue;
  }
  const budget = tier.tier === 'desktop' ? 4 : 8;
  if (tier.simulationTickMs.p95 > budget) {
    failures.push(
      `Field-sampling tick P95 ${tier.simulationTickMs.p95.toFixed(3)} ms exceeds the ${budget} ms ${tier.tier} budget.`,
    );
  }
}

const decisions = read('docs/DECISIONS.md');
for (const term of ['D019 | Accepted — P07', 'saturating union', 'stable source-ID order']) {
  if (!decisions.includes(term)) failures.push(`P07 decision log is missing: ${term}`);
}

const documentation = read('docs/P07-FIELD-API.md');
for (const term of [
  '+1 food',
  '-1 kill',
  'smootherstep',
  'order-independent',
  'depletion',
  'analytic',
  'Home, Forest, and Pond',
]) {
  if (!documentation.includes(term)) failures.push(`P07 documentation is missing: ${term}`);
}

const packageJson = JSON.parse(read('package.json'));
for (const script of ['validate:p07', 'qa']) {
  if (!packageJson.scripts?.[script]) failures.push(`Missing npm script: ${script}`);
}
if (!packageJson.scripts?.qa?.includes('validate:p07')) {
  failures.push('The qa script must run the P07 validator.');
}

if (failures.length > 0) {
  console.error('\nP07 validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('P07 signed environmental-field API is structurally valid.');
