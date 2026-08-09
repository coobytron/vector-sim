/**
 * P14 Jolt spike measurements.
 *
 *   npm run benchmark:jolt
 *
 * Reports WASM cold-init, module size, memory delta, physics step time, query
 * time, and combined simulation+physics frame cost at both quality tiers, plus
 * repeat-run state-hash equality.
 *
 * This measures the CPU-side cost in Node. Device-class browser FPS on the D011
 * baselines still needs the in-browser benchmark route on real hardware.
 */
import { statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { summarize } from '../src/benchmark/statistics';
import { loadJolt } from '../src/physics/joltLoader';
import { createJoltSpatialWorld } from '../src/physics/joltWorld';
import { PORCELAIN_TEST_SCENE } from '../src/physics/porcelainScene';
import { createSpatialFieldProvider } from '../src/physics/spatialProvider';
import { HeadlessSimulation } from '../src/simulation/headlessSimulation';
import { QUALITY_TIERS, type QualityTierName } from '../src/simulation/types';
import { vec3 } from '../src/environments/fields';

const require = createRequire(import.meta.url);
const WARMUP_FRAMES = 30;
const SAMPLE_FRAMES = 180;

function wasmBytes(): { wasm: number; glue: number } {
  const glue = require.resolve('jolt-physics/wasm');
  const wasm = glue.replace(/\.js$/, '.wasm');
  return { wasm: statSync(wasm).size, glue: statSync(glue).size };
}

function heapBytes(): number {
  return process.memoryUsage().rss;
}

/** Deterministic orbit so proxies traverse the scene the same way every run. */
function proxyPosition(index: number, frame: number, count: number) {
  const phase = (index / count) * Math.PI * 2 + frame * 0.01;
  return vec3(Math.cos(phase) * 1.6, 0.45 + Math.sin(frame * 0.02) * 0.15, Math.sin(phase) * 1.2);
}

async function runTier(tierName: QualityTierName) {
  const tier = QUALITY_TIERS[tierName];
  const organisms = tier.organisms;

  const rssBefore = heapBytes();
  const initStart = performance.now();
  const world = await createJoltSpatialWorld({
    scene: PORCELAIN_TEST_SCENE,
    loadJolt: () => loadJolt(),
  });
  const initMs = performance.now() - initStart;
  const rssAfter = heapBytes();

  for (let index = 0; index < organisms; index += 1) {
    world.addProxy({ id: `organism-${index}`, radius: 0.12, position: proxyPosition(index, 0, organisms) });
  }
  const providers = Array.from({ length: organisms }, (_unused, index) =>
    createSpatialFieldProvider(world, `organism-${index}`),
  );

  const simulation = new HeadlessSimulation({ tier, seed: 0x53504543 });

  for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
    simulation.step();
    world.step(1 / 30);
    for (const provider of providers) provider.sample(vec3(0, 0, 0));
  }

  const simMs: number[] = [];
  const physicsMs: number[] = [];
  const queryMs: number[] = [];
  const frameMs: number[] = [];

  for (let frame = 0; frame < SAMPLE_FRAMES; frame += 1) {
    const frameStart = performance.now();

    simulation.step();
    const afterSim = performance.now();

    for (let index = 0; index < organisms; index += 1) {
      world.setProxyPosition(`organism-${index}`, proxyPosition(index, frame, organisms));
    }
    world.step(1 / 30);
    const afterPhysics = performance.now();

    for (const provider of providers) {
      provider.sample(vec3(0, 0, 0));
    }
    const end = performance.now();

    simMs.push(afterSim - frameStart);
    physicsMs.push(afterPhysics - afterSim);
    queryMs.push(end - afterPhysics);
    frameMs.push(end - frameStart);
  }

  const hash = world.stateHash();
  world.destroy();

  const total = summarize(frameMs);
  return {
    tier: tierName,
    organisms,
    proxies: organisms,
    staticBodies: PORCELAIN_TEST_SCENE.bodies.length,
    initMs: Number(initMs.toFixed(2)),
    adapterReportedInitMs: world.initMs,
    rssDeltaBytes: rssAfter - rssBefore,
    simulationMs: summarize(simMs),
    physicsStepMs: summarize(physicsMs),
    queryMs: summarize(queryMs),
    totalFrameMs: total,
    budgetMs: tier.targetFrameMs,
    headroomAtP95: Number((tier.targetFrameMs - total.p95).toFixed(3)),
    estimatedFpsAtP50: Number((1000 / Math.max(total.median, 0.0001)).toFixed(1)),
    stateHash: hash,
  };
}

async function repeatabilityCheck(): Promise<{ runs: string[]; identical: boolean }> {
  const runs: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const world = await createJoltSpatialWorld({
      scene: PORCELAIN_TEST_SCENE,
      loadJolt: () => loadJolt(),
    });
    world.addProxy({ id: 'a', radius: 0.12, position: vec3(0, 0.6, 0) });
    for (let frame = 0; frame < 120; frame += 1) {
      world.setProxyPosition('a', proxyPosition(0, frame, 1));
      world.step(1 / 30);
      world.observe('a');
    }
    runs.push(world.stateHash());
    world.destroy();
  }
  return { runs, identical: new Set(runs).size === 1 };
}

const sizes = wasmBytes();
const report = {
  capturedAt: new Date().toISOString(),
  host: {
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    node: process.version,
  },
  joltVersion: require('jolt-physics/package.json').version,
  build: 'single-threaded wasm',
  moduleBytes: sizes,
  tiers: [await runTier('desktop'), await runTier('mobile')],
  repeatability: await repeatabilityCheck(),
};

mkdirSync('benchmark-results', { recursive: true });
const outPath = `benchmark-results/p14-jolt-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report, null, 2));
console.log(`\nwrote ${outPath}`);
