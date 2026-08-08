import { describe, expect, it } from 'vitest';
import fixture from '../src/nca/models/p06a-reference-checkpoint.json';
import {
  CheckpointValidationError,
  ReferenceRuntimeError,
  VectorNcaReferenceKernel,
  createReferenceRuntime,
  loadBrowserCheckpoint,
} from '../src/nca';
import type { BrowserCheckpointContainer, ReferenceRuntimeOptions } from '../src/nca';

const container = fixture as unknown as BrowserCheckpointContainer;
const checkpoint = loadBrowserCheckpoint(container);
const NODES = 32;

function runtime(overrides: Partial<ReferenceRuntimeOptions> = {}) {
  return createReferenceRuntime({ checkpoint, nodes: NODES, seed: 1337, ...overrides });
}

/** Field-like sensors: a positive lobe, a negative lobe, and a gradient ramp. */
function sensorField(): Float32Array {
  const sensors = new Float32Array(NODES * checkpoint.sensorChannels);
  for (let node = 0; node < NODES; node += 1) {
    const offset = node * checkpoint.sensorChannels;
    sensors[offset] = node < NODES / 2 ? 0.8 : 0;
    sensors[offset + 1] = node >= NODES / 2 ? -0.8 : 0;
    sensors[offset + 2] = (node / NODES) * 2 - 1;
    sensors[offset + 3] = 0.25;
    sensors[offset + 4] = 1;
    sensors[offset + 5] = 0;
  }
  return sensors;
}

describe('reference kernel', () => {
  it('reproduces the training-side rolled-neighbor update exactly', () => {
    const kernel = new VectorNcaReferenceKernel(checkpoint);
    const { latentChannels, sensorChannels, hiddenWidth, inputWidth } = kernel;
    const nodes = 4;

    const latent = Float32Array.from({ length: nodes * latentChannels }, (_u, i) =>
      Math.sin(i * 0.37),
    );
    const sensors = Float32Array.from({ length: nodes * sensorChannels }, (_u, i) =>
      Math.cos(i * 0.19),
    );
    const out = new Float32Array(latent.length);
    kernel.step(latent, sensors, nodes, out);

    // Independent recomputation of node 2, including neighbor = node 1.
    const weights1 = checkpoint.tensors['net.0.weight']?.data as Float32Array;
    const bias1 = checkpoint.tensors['net.0.bias']?.data as Float32Array;
    const weights2 = checkpoint.tensors['net.2.weight']?.data as Float32Array;
    const bias2 = checkpoint.tensors['net.2.bias']?.data as Float32Array;

    const node = 2;
    const input = new Float32Array(inputWidth);
    for (let channel = 0; channel < latentChannels; channel += 1) {
      input[channel] = latent[node * latentChannels + channel] as number;
      input[latentChannels + channel] = latent[(node - 1) * latentChannels + channel] as number;
    }
    for (let channel = 0; channel < sensorChannels; channel += 1) {
      input[latentChannels * 2 + channel] = sensors[node * sensorChannels + channel] as number;
    }

    const hidden = new Float32Array(hiddenWidth);
    for (let unit = 0; unit < hiddenWidth; unit += 1) {
      let total = bias1[unit] as number;
      for (let index = 0; index < inputWidth; index += 1) {
        total += (weights1[unit * inputWidth + index] as number) * (input[index] as number);
      }
      hidden[unit] = Math.tanh(total);
    }
    for (let channel = 0; channel < latentChannels; channel += 1) {
      let total = bias2[channel] as number;
      for (let unit = 0; unit < hiddenWidth; unit += 1) {
        total += (weights2[channel * hiddenWidth + unit] as number) * (hidden[unit] as number);
      }
      const expected =
        (latent[node * latentChannels + channel] as number) +
        Math.tanh(total) * checkpoint.updateRate;
      expect(out[node * latentChannels + channel]).toBeCloseTo(expected, 6);
    }
  });

  it('wraps the neighbor index at node 0', () => {
    const kernel = new VectorNcaReferenceKernel(checkpoint);
    const nodes = 3;
    const latent = new Float32Array(nodes * kernel.latentChannels);
    latent.fill(0.5, 2 * kernel.latentChannels, 3 * kernel.latentChannels);
    const sensors = new Float32Array(nodes * kernel.sensorChannels);

    const out = new Float32Array(latent.length);
    kernel.step(latent, sensors, nodes, out);

    // Node 0's neighbor is the last node, so a state only present there must
    // still reach node 0's update.
    const zeroOnly = new Float32Array(latent.length);
    const outZeroOnly = new Float32Array(latent.length);
    kernel.step(zeroOnly, sensors, nodes, outZeroOnly);
    expect(Array.from(out.subarray(0, kernel.latentChannels))).not.toEqual(
      Array.from(outZeroOnly.subarray(0, kernel.latentChannels)),
    );
  });

  it('refuses an architecture it cannot execute', () => {
    const foreign = { ...checkpoint, architecture: 'vector_nca_gnn_v9' as never };
    expect(() => new VectorNcaReferenceKernel(foreign)).toThrow(CheckpointValidationError);
  });
});

describe('deterministic evolution', () => {
  it('evolves 1,000 steps with no NaN and no divergence', () => {
    const instance = runtime({ sensors: sensorField() });
    instance.step(1000);

    expect(instance.tick).toBe(1000);
    let maxAbsolute = 0;
    for (const value of instance.state) {
      expect(Number.isFinite(value)).toBe(true);
      maxAbsolute = Math.max(maxAbsolute, Math.abs(value));
    }
    expect(maxAbsolute).toBeLessThan(1e3);
  });

  it('produces identical signatures from the same seed and inputs', () => {
    const first = runtime({ sensors: sensorField() });
    const second = runtime({ sensors: sensorField() });
    for (const steps of [1, 10, 100, 500]) {
      first.step(steps);
      second.step(steps);
      expect(first.signature()).toBe(second.signature());
    }
    expect(first.tick).toBe(second.tick);
    expect(Array.from(first.state)).toEqual(Array.from(second.state));
  });

  it('produces a different trajectory from a different seed', () => {
    const first = runtime({ seed: 1 });
    const second = runtime({ seed: 2 });
    first.step(25);
    second.step(25);
    expect(first.signature()).not.toBe(second.signature());
  });

  it('matches recorded fixture signatures', () => {
    const instance = runtime({ sensors: sensorField() });
    expect(instance.signature()).toBe('27dee174');
    instance.step(1);
    expect(instance.signature()).toBe('07c006eb');
    instance.step(9);
    expect(instance.signature()).toBe('8b9d541c');
    instance.step(90);
    expect(instance.signature()).toBe('da63ec7c');
    instance.step(900);
    expect(instance.signature()).toBe('acd77645');
  });

  it('reaches the same state whether stepped one at a time or in bulk', () => {
    const bulk = runtime({ sensors: sensorField() });
    const single = runtime({ sensors: sensorField() });
    bulk.step(64);
    for (let index = 0; index < 64; index += 1) {
      single.stepOnce();
    }
    expect(single.signature()).toBe(bulk.signature());
  });
});

describe('transport controls', () => {
  it('pauses, single-steps while paused, and resumes', () => {
    const instance = runtime();
    instance.step(5);
    const pausedSignature = instance.signature();

    instance.pause();
    expect(instance.paused).toBe(true);
    instance.step(10);
    expect(instance.tick).toBe(5);
    expect(instance.signature()).toBe(pausedSignature);

    // Single-step is the manual control and ignores the paused flag.
    instance.stepOnce();
    expect(instance.tick).toBe(6);
    expect(instance.signature()).not.toBe(pausedSignature);

    instance.resume();
    instance.step(4);
    expect(instance.tick).toBe(10);
  });

  it('resets to the seeded initial state', () => {
    const instance = runtime();
    const initial = instance.signature();
    instance.step(50);
    expect(instance.signature()).not.toBe(initial);

    instance.reset();
    expect(instance.tick).toBe(0);
    expect(instance.signature()).toBe(initial);

    instance.step(50);
    const replay = instance.signature();
    instance.reset();
    instance.step(50);
    expect(instance.signature()).toBe(replay);
  });

  it('reseeds to a new deterministic starting point', () => {
    const instance = runtime({ seed: 5 });
    instance.step(10);
    instance.reseed(9);
    expect(instance.tick).toBe(0);

    const reference = runtime({ seed: 9 });
    expect(instance.signature()).toBe(reference.signature());
    instance.step(10);
    reference.step(10);
    expect(instance.signature()).toBe(reference.signature());
  });

  it('validates sensor and step arguments', () => {
    const instance = runtime();
    expect(() => instance.setSensors(new Float32Array(3))).toThrow(ReferenceRuntimeError);
    expect(() => instance.step(-1)).toThrow(ReferenceRuntimeError);
    expect(() => createReferenceRuntime({ checkpoint, nodes: 0, seed: 1 })).toThrow(
      ReferenceRuntimeError,
    );
    expect(() => createReferenceRuntime({ checkpoint, nodes: 4, seed: 1, sensors: new Float32Array(5) })).toThrow(
      ReferenceRuntimeError,
    );
  });

  it('changes trajectory when sensors change', () => {
    const quiet = runtime();
    const driven = runtime();
    driven.setSensors(sensorField());
    quiet.step(20);
    driven.step(20);
    expect(quiet.signature()).not.toBe(driven.signature());
  });
});

describe('controlled lesions', () => {
  it('clears exactly the requested nodes', () => {
    const instance = runtime({ sensors: sensorField() });
    instance.step(20);
    const cleared = instance.applyLesion({ nodeIndices: [3, 1, 1] });

    expect(cleared).toEqual([1, 3]);
    expect(instance.lesionedNodes).toEqual([1, 3]);
    for (const node of cleared) {
      const slice = instance.state.subarray(
        node * checkpoint.latentChannels,
        (node + 1) * checkpoint.latentChannels,
      );
      expect(Array.from(slice).every((value) => value === 0)).toBe(true);
    }
    const untouched = instance.state.subarray(0, checkpoint.latentChannels);
    expect(Array.from(untouched).some((value) => value !== 0)).toBe(true);
  });

  it('selects a fractional lesion deterministically', () => {
    const first = runtime();
    const second = runtime();
    first.step(10);
    second.step(10);
    const a = first.applyLesion({ fraction: 0.25 });
    const b = second.applyLesion({ fraction: 0.25 });

    expect(a).toEqual(b);
    expect(a.length).toBe(8);
    expect([...a].sort((x, y) => x - y)).toEqual([...a]);
    expect(first.signature()).toBe(second.signature());
  });

  it('recovers deterministically after a lesion', () => {
    const first = runtime({ sensors: sensorField() });
    const second = runtime({ sensors: sensorField() });
    first.step(30);
    second.step(30);
    first.applyLesion({ fraction: 0.25 });
    second.applyLesion({ fraction: 0.25 });
    first.step(200);
    second.step(200);

    expect(first.signature()).toBe(second.signature());
    for (const value of first.state) {
      expect(Number.isFinite(value)).toBe(true);
    }

    // A lesion must actually change the outcome, not silently no-op.
    const unlesioned = runtime({ sensors: sensorField() });
    unlesioned.step(230);
    expect(first.signature()).not.toBe(unlesioned.signature());
  });

  it('rejects out-of-range lesion requests', () => {
    const instance = runtime();
    expect(() => instance.applyLesion({ nodeIndices: [NODES] })).toThrow(ReferenceRuntimeError);
    expect(() => instance.applyLesion({ nodeIndices: [-1] })).toThrow(ReferenceRuntimeError);
    expect(() => instance.applyLesion({ fraction: 1.5 })).toThrow(ReferenceRuntimeError);
  });

  it('clears lesion bookkeeping on reset', () => {
    const instance = runtime();
    instance.step(5);
    instance.applyLesion({ fraction: 0.5 });
    expect(instance.lesionedNodes.length).toBe(16);
    instance.reset();
    expect(instance.lesionedNodes).toEqual([]);
  });
});

describe('corruption guard', () => {
  it('reports the tick where state stops being finite', () => {
    const exploding = {
      ...checkpoint,
      updateRate: 1e38,
      tensors: {
        ...checkpoint.tensors,
        'net.2.bias': {
          name: 'net.2.bias',
          shape: [checkpoint.latentChannels],
          data: Float32Array.from({ length: checkpoint.latentChannels }, () => 5),
        },
      },
    };
    const instance = createReferenceRuntime({ checkpoint: exploding, nodes: 4, seed: 3 });
    expect(() => instance.step(50)).toThrow(/non-finite at tick/);
  });

  it('can be told not to guard', () => {
    const exploding = { ...checkpoint, updateRate: 1e38 };
    const instance = createReferenceRuntime({
      checkpoint: exploding,
      nodes: 4,
      seed: 3,
      guardNonFinite: false,
    });
    expect(() => instance.step(50)).not.toThrow();
  });
});
