import { describe, expect, it } from 'vitest';
import { isEventActive, sampleSpectralEvent, type SpectralEvent } from '../src/spectral/events';

const events: SpectralEvent[] = [
  'feeding',
  'hazard',
  'damage',
  'regeneration',
  'mutation',
  'death',
  'inspection',
];

describe('semantic spectral events', () => {
  it('keeps every semantic wavelength inside the documented visible range', () => {
    for (const event of events) {
      for (let step = 0; step < 100; step += 1) {
        const sample = sampleSpectralEvent(event, step / 100);
        expect(sample.wavelengthNm).toBeGreaterThanOrEqual(380);
        expect(sample.wavelengthNm).toBeLessThanOrEqual(700);
        expect(sample.intensityScale).toBeGreaterThanOrEqual(0);
        expect(sample.motion.length).toBeGreaterThan(0);
        expect(sample.formCue.length).toBeGreaterThan(0);
      }
    }
  });

  it('distinguishes states with motion and form rather than hue alone', () => {
    const semanticPairs = events.map((event) => {
      const sample = sampleSpectralEvent(event, 0.4);
      return `${sample.motion}/${sample.formCue}`;
    });
    expect(new Set(semanticPairs).size).toBe(events.length);
  });

  it('wraps phases deterministically for replay', () => {
    expect(sampleSpectralEvent('feeding', 0.25)).toEqual(sampleSpectralEvent('feeding', 1.25));
    expect(sampleSpectralEvent('damage', -0.25)).toEqual(sampleSpectralEvent('damage', 0.75));
  });

  it('keeps event gates half-open at the ending tick', () => {
    const gate = { event: 'feeding' as const, sourceId: 'threshold', startTick: 10, durationTicks: 5 };
    expect(isEventActive(gate, 9)).toBe(false);
    expect(isEventActive(gate, 10)).toBe(true);
    expect(isEventActive(gate, 14)).toBe(true);
    expect(isEventActive(gate, 15)).toBe(false);
  });
});
