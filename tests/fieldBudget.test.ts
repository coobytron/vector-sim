import { describe, expect, it } from 'vitest';
import { HOME_MANIFEST } from '../src/environments/manifests';
import { loadEnvironment } from '../src/fields/manifest';
import { FIELD_BATCH_CHANNELS, FIELD_BATCH_STRIDE } from '../src/fields/types';
import { HeadlessSimulation } from '../src/simulation/headlessSimulation';
import { QUALITY_TIERS } from '../src/simulation/types';

/**
 * Ceiling for one full-population field batch. The P02 desktop budget allows
 * 4 ms for the whole tick; sampling is allowed a quarter of it. The committed
 * benchmark JSON is the authoritative measurement — this only fails a change
 * that regresses the cost by an order of magnitude.
 */
const BATCH_BUDGET_MS = 1;

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

describe('field query budget', () => {
  it('keeps the batch layout aligned with the perception contract', () => {
    expect(FIELD_BATCH_CHANNELS).toHaveLength(FIELD_BATCH_STRIDE);
    // Food/kill/effect 3 + gradient 4 + obstacle 4 + shelter 1 + habitat 3 + flow 3.
    expect(FIELD_BATCH_STRIDE).toBe(3 + 4 + 4 + 1 + 3 + 3);
  });

  it('samples a full desktop population inside the tick budget', () => {
    const simulation = new HeadlessSimulation({
      tier: QUALITY_TIERS.desktop,
      seed: 0x53504543,
    });
    for (let tick = 0; tick < 30; tick += 1) simulation.step();

    const sampler = loadEnvironment(HOME_MANIFEST);
    const positions = simulation.snapshot.positions;
    const count = simulation.nodeCount;
    expect(count).toBe(2048);

    const batch = new Float32Array(count * FIELD_BATCH_STRIDE);
    const contacts = new Int32Array(count);
    for (let warmup = 0; warmup < 20; warmup += 1) {
      sampler.sampleBatch(positions, count, batch, contacts);
    }

    const samples: number[] = [];
    for (let run = 0; run < 40; run += 1) {
      const start = performance.now();
      sampler.sampleBatch(positions, count, batch, contacts);
      samples.push(performance.now() - start);
    }
    expect(median(samples)).toBeLessThan(BATCH_BUDGET_MS);
  });

  it('reuses its buffers instead of allocating per sample', () => {
    const sampler = loadEnvironment(HOME_MANIFEST);
    const first = sampler.sample(0, 1, 0);
    const second = sampler.sample(0.2, 1, 0);
    // The default scratch sample is shared, which is what keeps the tick free of
    // per-cell garbage.
    expect(second).toBe(first);
  });
});
