import { describe, expect, it } from 'vitest';
import { MotionTrailBuffer } from '../src/rendering/motionTrailBuffer';

function oneNode(x: number): Float32Array {
  return new Float32Array([x, 0.5, 0]);
}

describe('MotionTrailBuffer', () => {
  it('reuses pooled arrays and samples at most once per simulation tick', () => {
    const trails = new MotionTrailBuffer(1, 5);
    const positions = trails.buffers.positions;
    const colors = trails.buffers.colors;
    const organism = new Uint16Array([0]);
    const scales = new Float32Array([1]);
    const persistence = new Float32Array([1]);

    trails.update(1, oneNode(0), organism, scales, persistence);
    trails.update(1, oneNode(1), organism, scales, persistence);
    expect(trails.buffers.visibleSegmentCounts[0]).toBe(0);

    trails.update(2, oneNode(2), organism, scales, persistence);
    expect(trails.buffers.positions).toBe(positions);
    expect(trails.buffers.colors).toBe(colors);
    expect(trails.buffers.visibleSegmentCounts[0]).toBe(1);
  });

  it('uses persistence to shorten and fully evaporate history', () => {
    const trails = new MotionTrailBuffer(1, 6);
    const organism = new Uint16Array([0]);
    const scales = new Float32Array([1]);

    for (let tick = 1; tick <= 6; tick += 1) {
      trails.update(tick, oneNode(tick), organism, scales, new Float32Array([1]));
    }
    expect(trails.buffers.visibleSegmentCounts[0]).toBe(5);

    trails.update(6, oneNode(6), organism, scales, new Float32Array([0.4]));
    expect(trails.buffers.visibleSegmentCounts[0]).toBe(2);

    trails.update(6, oneNode(6), organism, scales, new Float32Array([0]));
    expect(trails.buffers.visibleSegmentCounts[0]).toBe(0);
    const p = trails.buffers.positions;
    for (let offset = 0; offset < p.length; offset += 6) {
      expect(p[offset]).toBe(p[offset + 3]);
      expect(p[offset + 1]).toBe(p[offset + 4]);
      expect(p[offset + 2]).toBe(p[offset + 5]);
    }
  });

  it('centers history on visible nodes only', () => {
    const trails = new MotionTrailBuffer(1, 4);
    const organism = new Uint16Array([0, 0]);
    const persistence = new Float32Array([1]);

    trails.update(
      1,
      new Float32Array([0, 0, 0, 100, 0, 0]),
      organism,
      new Float32Array([1, 0]),
      persistence,
    );
    trails.update(
      2,
      new Float32Array([2, 0, 0, 100, 0, 0]),
      organism,
      new Float32Array([1, 0]),
      persistence,
    );

    expect(Array.from(trails.buffers.positions.slice(0, 6))).toEqual([2, 0, 0, 0, 0, 0]);
  });
});
