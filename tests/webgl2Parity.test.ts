import { describe, expect, it } from 'vitest';
import {
  compareNcaStates,
  toleranceSignature,
} from '../src/nca';

describe('NCA CPU/GPU parity metrics', () => {
  it('reports exact agreement', () => {
    const state = Float32Array.from([0.1, -0.2, 3.5, 0]);
    const result = compareNcaStates(state, state.slice(), 1e-5);
    expect(result.withinTolerance).toBe(true);
    expect(result.maxAbsoluteError).toBe(0);
    expect(result.overTolerance).toBe(0);
    expect(result.cpuSignature).toBe(result.gpuSignature);
  });

  it('counts values outside the requested tolerance', () => {
    const cpu = Float32Array.from([0, 1, 2]);
    const gpu = Float32Array.from([0.00001, 1.001, 1.98]);
    const result = compareNcaStates(cpu, gpu, 0.002);
    expect(result.withinTolerance).toBe(false);
    expect(result.overTolerance).toBe(1);
    expect(result.maxAbsoluteError).toBeCloseTo(0.02, 5);
    expect(result.rmsError).toBeGreaterThan(0);
  });

  it('produces stable tolerance signatures', () => {
    const state = Float32Array.from([0.125, -0.5, 2.25]);
    expect(toleranceSignature(state, 0.001)).toBe(
      toleranceSignature(state.slice(), 0.001),
    );
    expect(toleranceSignature(state, 0.001)).not.toBe(
      toleranceSignature(Float32Array.from([0.125, -0.5, 2.5]), 0.001),
    );
  });

  it('rejects mismatched state lengths', () => {
    expect(() =>
      compareNcaStates(new Float32Array(2), new Float32Array(3), 0.01),
    ).toThrow(/state lengths differ/);
  });
});
