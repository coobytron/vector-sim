import { describe, expect, it } from 'vitest';
import { createBrowserParityInputs } from '../src/nca/browserParityReceipt';

describe('P06 browser parity fixture inputs', () => {
  it('is deterministic and sized from the checkpoint contract', () => {
    const first = createBrowserParityInputs(4, 16, 6);
    const second = createBrowserParityInputs(4, 16, 6);
    expect(first.initialState.length).toBe(64);
    expect(first.sensors.length).toBe(24);
    expect(Array.from(first.initialState)).toEqual(Array.from(second.initialState));
    expect(Array.from(first.sensors)).toEqual(Array.from(second.sensors));
    expect(Array.from(first.initialState).some((value) => value !== 0)).toBe(true);
    expect(Array.from(first.sensors).some((value) => value !== 0)).toBe(true);
  });
});
