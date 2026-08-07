import { describe, expect, it } from 'vitest';
import {
  acesFilmicToneMap,
  evaluateSpectralColor,
  gamutMapSpectralRgb,
  linearToSrgb,
  mixLinearRgb,
  spectralEmissionLinear,
  srgbToLinear,
  wavelengthToLinearRgb,
} from '../src/spectral/color';

function expectFiniteRgb(color: { r: number; g: number; b: number }): void {
  expect(Object.values(color).every(Number.isFinite)).toBe(true);
}

describe('wavelength-to-linear-sRGB conversion', () => {
  it('keeps the visible sequence ordered without a hand-picked RGB ramp', () => {
    const violet = wavelengthToLinearRgb(410);
    const cyan = wavelengthToLinearRgb(490);
    const green = wavelengthToLinearRgb(540);
    const red = wavelengthToLinearRgb(660);

    expect(violet.b).toBeGreaterThan(violet.r);
    expect(cyan.b + cyan.g).toBeGreaterThan(cyan.r * 2);
    expect(green.g).toBeGreaterThan(green.r);
    expect(green.g).toBeGreaterThan(green.b);
    expect(red.r).toBeGreaterThan(red.g + red.b);
  });

  it('returns finite in-gamut colors across the supported wavelength range', () => {
    for (let wavelength = 380; wavelength <= 780; wavelength += 1) {
      const color = wavelengthToLinearRgb(wavelength);
      expectFiniteRgb(color);
      expect(Math.min(color.r, color.g, color.b)).toBeGreaterThanOrEqual(0);
      expect(Math.max(color.r, color.g, color.b)).toBeLessThanOrEqual(1);
    }
  });

  it('maps out-of-gamut spectral values without changing channel order', () => {
    const mapped = gamutMapSpectralRgb({ r: 1.7, g: -0.3, b: 0.2 });
    expect(mapped.r).toBeGreaterThan(mapped.b);
    expect(mapped.b).toBeGreaterThan(mapped.g);
    expect(mapped.g).toBe(0);
    expect(mapped.r).toBe(1);
  });
});

describe('linear-light output contract', () => {
  it('round-trips the sRGB transfer without a second encoding', () => {
    const display = { r: 0.08, g: 0.42, b: 0.91 };
    const roundTrip = linearToSrgb(srgbToLinear(display));
    expect(roundTrip.r).toBeCloseTo(display.r, 8);
    expect(roundTrip.g).toBeCloseTo(display.g, 8);
    expect(roundTrip.b).toBeCloseTo(display.b, 8);

    const doubleEncoded = linearToSrgb(roundTrip);
    expect(Math.abs(doubleEncoded.g - display.g)).toBeGreaterThan(0.2);
  });

  it('mixes energy in linear light rather than interpolating display RGB', () => {
    const redLinear = srgbToLinear({ r: 1, g: 0, b: 0 });
    const greenLinear = srgbToLinear({ r: 0, g: 1, b: 0 });
    const mixedDisplay = linearToSrgb(mixLinearRgb(redLinear, greenLinear, 0.5));
    expect(mixedDisplay.r).toBeGreaterThan(0.7);
    expect(mixedDisplay.g).toBeGreaterThan(0.7);
    expect(mixedDisplay.b).toBe(0);
  });

  it('keeps neutral values neutral through ACES and the output transfer', () => {
    for (const neutral of [0.1, 0.5, 0.92, 2, 8]) {
      const toneMapped = acesFilmicToneMap({ r: neutral, g: neutral, b: neutral }, 0.86);
      const display = linearToSrgb(toneMapped);
      expect(display.r).toBeCloseTo(display.g, 5);
      expect(display.g).toBeCloseTo(display.b, 5);
    }
  });

  it('rolls HDR emission toward white while retaining internal detail', () => {
    const low = evaluateSpectralColor(510, 0.5);
    const high = evaluateSpectralColor(510, 8);
    expect(high.displayRgb.g).toBeGreaterThan(low.displayRgb.g);
    expect(high.displayRgb.r).toBeGreaterThan(low.displayRgb.r);
    expect(high.displayRgb.b).toBeGreaterThan(low.displayRgb.b);
    expect(new Set(Object.values(high.displayRgb).map((value) => value.toFixed(4))).size).toBeGreaterThan(1);
    expect(Math.max(...Object.values(high.displayRgb))).toBeLessThanOrEqual(1);
  });

  it('keeps intensity separate and deterministic for live/export consumers', () => {
    const first = spectralEmissionLinear(532, 2.25);
    const second = spectralEmissionLinear(532, 2.25);
    expect(first).toEqual(second);
    expectFiniteRgb(first);
  });
});
