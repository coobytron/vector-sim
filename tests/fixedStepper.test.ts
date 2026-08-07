import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../src/simulation/fixedStepper';

describe('FixedStepper', () => {
  it('runs fixed 30 Hz ticks independent of render cadence', () => {
    const stepper = new FixedStepper(1 / 30, 4);
    let ticks = 0;
    stepper.advance(0, () => {
      ticks += 1;
    });
    const frame = stepper.advance(1 / 15, () => {
      ticks += 1;
    });
    expect(ticks).toBe(2);
    expect(frame.steps).toBe(2);
    expect(frame.alpha).toBeCloseTo(0, 8);
  });

  it('caps catch-up and reports dropped wall time', () => {
    const stepper = new FixedStepper(1 / 30, 4);
    stepper.advance(0, () => undefined);
    const frame = stepper.advance(1, () => undefined);
    expect(frame.steps).toBe(4);
    expect(frame.droppedSeconds).toBeCloseTo(1 - 4 / 30, 8);
  });
});

