import { describe, expect, it } from 'vitest';
import { counterRandom, SeededRandom } from '../src/simulation/prng';

describe('seeded random sources', () => {
  it('replays the same sequence from the same seed', () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);
    expect(Array.from({ length: 8 }, () => first.next())).toEqual(
      Array.from({ length: 8 }, () => second.next()),
    );
  });

  it('keys the asynchronous gate by seed, organism, cell, tick, and stream', () => {
    const value = counterRandom(7, 2, 19, 300, 1);
    expect(value).toBe(counterRandom(7, 2, 19, 300, 1));
    expect(value).not.toBe(counterRandom(7, 2, 19, 301, 1));
    expect(value).not.toBe(counterRandom(7, 2, 19, 300, 2));
  });
});

