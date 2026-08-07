import { describe, expect, it } from 'vitest';
import { summarize } from '../src/benchmark/statistics';

describe('benchmark statistics', () => {
  it('reports median, tail percentiles, worst frame, and mean', () => {
    const summary = summarize([10, 20, 30, 40, 50]);
    expect(summary.median).toBe(30);
    expect(summary.p95).toBeCloseTo(48);
    expect(summary.p99).toBeCloseTo(49.6);
    expect(summary.max).toBe(50);
    expect(summary.mean).toBe(30);
  });
});

