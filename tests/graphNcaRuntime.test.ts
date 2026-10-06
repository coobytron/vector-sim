import { describe, expect, it } from 'vitest';
import weights from '../src/nca/models/branching-m1.weights.json';
import {
  ALIVE_CHANNEL,
  GraphNcaModelError,
  createGraphNcaStepper,
  graphNcaNeutralSensors,
  graphNcaSeedState,
  loadGraphNcaModel,
} from '../src/nca/graph/graphNcaRuntime';
import type { GraphNcaWeightsJson } from '../src/nca/graph/graphNcaRuntime';

const json = weights as GraphNcaWeightsJson;

describe('M1 graph NCA CPU reference runtime', () => {
  const model = loadGraphNcaModel(json);

  it('loads the M1 Branching checkpoint exported by training', () => {
    expect(model.nodes).toBe(128);
    expect(model.channels).toBe(16);
    expect(model.w1.length).toBe(64 * 70);
    expect(model.parents[0]).toBe(-1);
  });

  it('reproduces the PyTorch golden frames at ticks 1, 8 and 32', () => {
    const golden = json.golden!;
    const stepper = createGraphNcaStepper(model, golden.fire_seed, golden.fire_stream);
    const state = graphNcaSeedState(model);
    const sensors = graphNcaNeutralSensors(model);
    let tick = 0;
    for (const frame of golden.frames) {
      for (; tick < frame.tick; tick += 1) stepper.step(state, sensors, tick);
      let maxError = 0;
      frame.state.forEach((expected, index) => {
        maxError = Math.max(maxError, Math.abs(state[index]! - expected));
      });
      expect(maxError, `tick ${frame.tick}`).toBeLessThan(1e-5);
    }
  });

  it('grows from the seed and keeps every node alive and bounded over 512 ticks', () => {
    const stepper = createGraphNcaStepper(model, 900001, 1);
    const state = graphNcaSeedState(model);
    const sensors = graphNcaNeutralSensors(model);
    for (let tick = 0; tick < 512; tick += 1) stepper.step(state, sensors, tick);
    let alive = 0;
    for (let node = 0; node < model.nodes; node += 1) {
      if (state[node * model.channels + ALIVE_CHANNEL]! > 0.1) alive += 1;
    }
    expect(alive).toBe(model.nodes);
    expect(state.every((value) => Number.isFinite(value) && Math.abs(value) < 1.5)).toBe(true);
  });

  it('is deterministic for a fixed fire seed', () => {
    const run = () => {
      const stepper = createGraphNcaStepper(model, 7, 3);
      const state = graphNcaSeedState(model);
      const sensors = graphNcaNeutralSensors(model);
      for (let tick = 0; tick < 64; tick += 1) stepper.step(state, sensors, tick);
      return state;
    };
    expect(run()).toEqual(run());
  });

  it('rejects malformed weights', () => {
    expect(() => loadGraphNcaModel({ ...json, format: 'other' })).toThrow(GraphNcaModelError);
    expect(() =>
      loadGraphNcaModel({ ...json, tensors: { ...json.tensors, b1: { shape: [3], data: [0, 0, 0] } } }),
    ).toThrow(GraphNcaModelError);
  });
});
