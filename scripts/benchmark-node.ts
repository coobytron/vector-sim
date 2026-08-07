import { cpus, freemem, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { summarize } from '../src/benchmark/statistics';
import { VectorBufferPacker } from '../src/rendering/vectorBufferPacker';
import { HeadlessSimulation } from '../src/simulation/headlessSimulation';
import { QUALITY_TIERS, type QualityTierName } from '../src/simulation/types';

interface TierResult {
  tier: QualityTierName;
  organisms: number;
  slotsPerOrganism: number;
  nodes: number;
  edges: number;
  samples: number;
  pairedTickAndPackMs: ReturnType<typeof summarize>;
  simulationTickMs: ReturnType<typeof summarize>;
  vectorPackMs: ReturnType<typeof summarize>;
  finalTick: number;
  stateHash: string;
  estimatedStateBytes: number;
}

function runTier(tierName: QualityTierName): TierResult {
  const tier = QUALITY_TIERS[tierName];
  const simulation = new HeadlessSimulation({ tier, seed: 0x53504543 });
  const packer = new VectorBufferPacker(simulation.snapshot);
  const warmup = 30;
  const samples = 180;
  for (let tick = 0; tick < warmup; tick += 1) {
    simulation.step();
    packer.update(simulation.snapshot, 1);
  }

  const paired: number[] = [];
  const simulationTimes: number[] = [];
  const packTimes: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const pairedStart = performance.now();
    const simulationStart = pairedStart;
    simulation.step();
    const packStart = performance.now();
    packer.update(simulation.snapshot, 1);
    const end = performance.now();
    simulationTimes.push(packStart - simulationStart);
    packTimes.push(end - packStart);
    paired.push(end - pairedStart);
  }

  const snapshot = simulation.snapshot;
  const estimatedStateBytes =
    snapshot.active.byteLength +
    snapshot.positions.byteLength * 5 +
    snapshot.energy.byteLength +
    snapshot.health.byteLength +
    snapshot.edges.byteLength +
    simulation.nodeCount * simulation.channels * Float32Array.BYTES_PER_ELEMENT * 3;

  return {
    tier: tierName,
    organisms: tier.organisms,
    slotsPerOrganism: tier.slotsPerOrganism,
    nodes: simulation.nodeCount,
    edges: snapshot.edges.length / 2,
    samples,
    pairedTickAndPackMs: summarize(paired),
    simulationTickMs: summarize(simulationTimes),
    vectorPackMs: summarize(packTimes),
    finalTick: simulation.tick,
    stateHash: simulation.stateHash(),
    estimatedStateBytes,
  };
}

const result = {
  schema: 'vector-sim-node-benchmark-v1',
  timestamp: new Date().toISOString(),
  measurementClass: 'CPU reference + vector-buffer preparation; no GPU rasterization',
  runtime: {
    node: process.version,
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytesAtStart: freemem(),
  },
  tiers: [runTier('mobile'), runTier('desktop')],
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
