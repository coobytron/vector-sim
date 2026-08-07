import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];
const required = [
  'index.html',
  'vite.config.ts',
  'src/app/createApp.ts',
  'src/simulation/headlessSimulation.ts',
  'src/simulation/fixedStepper.ts',
  'src/nca/referenceKernel.ts',
  'src/nca/models/reference-fixture-v1.json',
  'src/rendering/vectorRenderer.ts',
  'src/rendering/vectorBufferPacker.ts',
  'src/rendering/shaders/benchmark-pingpong.frag.glsl',
  'src/rendering/shaders/benchmark-transform-feedback.vert.glsl',
  'src/benchmark/browserBenchmark.ts',
  'src/benchmark/gpuMicrobenchmarks.ts',
  'benchmark-results/node-reference-2026-08-07.json',
  'docs/ARCHITECTURE.md',
  'docs/P02-BENCHMARK.md',
  'docs/adr/0001-runtime-backend.md',
  '.github/workflows/ci.yml',
];

for (const path of required) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) failures.push(`Missing P02 file: ${path}`);
  else if (statSync(absolute).size === 0) failures.push(`Empty P02 file: ${path}`);
}

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

for (const scope of ['src/simulation', 'src/nca']) {
  for (const path of walk(resolve(root, scope))) {
    if (!['.ts', '.json'].includes(extname(path))) continue;
    const content = readFileSync(path, 'utf8');
    if (/from ['"]three|\bdocument\b|\bwindow\b|HTMLCanvasElement/.test(content)) {
      failures.push(`Headless boundary violation: ${path.slice(root.length + 1)}`);
    }
  }
}

const model = JSON.parse(
  readFileSync(resolve(root, 'src/nca/models/reference-fixture-v1.json'), 'utf8'),
);
if (model.channels !== 24) failures.push('Reference model must keep 24 channels.');
if (model.runtimeMutable !== false) failures.push('Reference model weights must be immutable at runtime.');

const benchmark = JSON.parse(
  readFileSync(resolve(root, 'benchmark-results/node-reference-2026-08-07.json'), 'utf8'),
);
if (benchmark.schema !== 'vector-sim-node-benchmark-v1') {
  failures.push('Unexpected Node benchmark schema.');
}
for (const tierName of ['mobile', 'desktop']) {
  const tier = benchmark.tiers?.find((candidate) => candidate.tier === tierName);
  if (!tier) {
    failures.push(`Missing ${tierName} Node benchmark result.`);
    continue;
  }
  const distribution = tier.pairedTickAndPackMs;
  for (const key of ['median', 'p95', 'p99', 'max']) {
    if (!Number.isFinite(distribution?.[key])) {
      failures.push(`Missing ${tierName} ${key} benchmark percentile.`);
    }
  }
}

const vite = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
if (!vite.includes("base: './'")) failures.push('Vite build must remain relative-path static-host compatible.');

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
for (const script of ['dev', 'build', 'lint', 'test', 'benchmark:node', 'validate:p02', 'qa']) {
  if (!packageJson.scripts?.[script]) failures.push(`Missing npm script: ${script}`);
}

const decisions = readFileSync(resolve(root, 'docs/DECISIONS.md'), 'utf8');
for (const term of ['D010 | Accepted — P02', 'D011 | Accepted — P02', 'iPhone 16 Pro', 'M1 Max']) {
  if (!decisions.includes(term)) failures.push(`P02 decision log is missing: ${term}`);
}

if (failures.length > 0) {
  console.error('\nP02 validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('P02 runtime scaffold and benchmark package is structurally valid.');
