import { describe, expect, it } from 'vitest';
import {
  parseCaptureDistance,
  parseCaptureState,
  parseCaptureTick,
  parseNcaMode,
  parseRunSeed,
} from '../src/organisms/captureRoute';

describe('organism capture route', () => {
  it('parses stable capture dimensions and clamps expensive ticks', () => {
    expect(parseRunSeed('0x10')).toBe(16);
    expect(parseRunSeed('42')).toBe(42);
    expect(parseCaptureTick('180')).toBe(180);
    expect(parseCaptureTick('5000')).toBe(900);
    expect(parseCaptureDistance('macro')).toBe('macro');
    expect(parseCaptureDistance('far')).toBeUndefined();
  });

  it('accepts only versioned state and NCA modes', () => {
    expect(parseCaptureState('regenerating')).toBe('regenerating');
    expect(parseCaptureState('rainbow')).toBeUndefined();
    expect(parseNcaMode('frozen')).toBe('frozen');
    expect(parseNcaMode('unknown')).toBe('live');
  });
});
