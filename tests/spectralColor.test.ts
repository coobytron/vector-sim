import { describe, expect, it } from 'vitest';
import {
  acesFilmicToneMap,
  adjustLinearSaturation,
  DEFAULT_OUTPUT_SATURATION,
  DEFAULT_SPECTRAL_CHROMA_GAIN,
  DEATH_WAVELENGTH_NM,
  evaluateSpectralColor,
  gamutMapSpectralRgb,
  LIFE_WAVELENGTH_NM,
  linearToSrgb,
  lifeDeathToWavelength,
  mixLinearRgb,
  SPECTRAL_CLAMP_MAX_NM,
  SPECTRAL_CLAMP_MIN_NM,
  spectralEmissionLinear,
  srgbToLinear,
  wavelengthToLinearRgb,
} from '../src/spectral/color';

function expectFiniteRgb(color: { r: number; g: number; b: number }): void {
  expect(Object.values(color).every(Number.isFinite)).toBe(true);
}

function chroma(color: { r: number; g: number; b: number }): number {
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
}

function dominantSeparation(color: { r: number; g: number; b: number }): number {
  const channels = [color.r, color.g, color.b].sort((first, second) => second - first);
  return (channels[0] ?? 0) - (channels[1] ?? 0);
}

describe('wavelength-to-linear-sRGB conversion', () => {
  it('keeps the approved blue-to-red sequence ordered without a hand-picked RGB ramp', () => {
    const blue = wavelengthToLinearRgb(LIFE_WAVELENGTH_NM);
    const cyan = wavelengthToLinearRgb(490);
    const green = wavelengthToLinearRgb(540);
    const red = wavelengthToLinearRgb(620);

    expect(blue.b).toBeGreaterThan(blue.r);
    expect(blue.b).toBeGreaterThan(blue.g);
    expect(cyan.b + cyan.g).toBeGreaterThan(cyan.r * 2);
    expect(green.g).toBeGreaterThan(green.r);
    expect(green.g).toBeGreaterThan(green.b);
    expect(red.r).toBeGreaterThan(red.g + red.b);
  });

  it('returns finite in-gamut colors across raw visible-spectrum inputs', () => {
    for (let wavelength = 380; wavelength <= 780; wavelength += 1) {
      const color = wavelengthToLinearRgb(wavelength);
      expectFiniteRgb(color);
      expect(Math.min(color.r, color.g, color.b)).toBeGreaterThanOrEqual(0);
      expect(Math.max(color.r, color.g, color.b)).toBeLessThanOrEqual(1);
    }
  });

  it('hard-clamps authored color to 470–620 nm', () => {
    expect(SPECTRAL_CLAMP_MIN_NM).toBe(470);
    expect(SPECTRAL_CLAMP_MAX_NM).toBe(620);
    expect(wavelengthToLinearRgb(380)).toEqual(wavelengthToLinearRgb(LIFE_WAVELENGTH_NM));
    expect(wavelengthToLinearRgb(780)).toEqual(wavelengthToLinearRgb(DEATH_WAVELENGTH_NM));
    expect(evaluateSpectralColor(120, 1).wavelengthNm).toBe(LIFE_WAVELENGTH_NM);
    expect(evaluateSpectralColor(900, 1).wavelengthNm).toBe(DEATH_WAVELENGTH_NM);
  });

  it('reserves the blue endpoint for life and the red endpoint for death', () => {
    expect(lifeDeathToWavelength(0)).toBe(LIFE_WAVELENGTH_NM);
    expect(lifeDeathToWavelength(1)).toBe(DEATH_WAVELENGTH_NM);
    expect(lifeDeathToWavelength(-1)).toBe(LIFE_WAVELENGTH_NM);
    expect(lifeDeathToWavelength(2)).toBe(DEATH_WAVELENGTH_NM);

    const life = wavelengthToLinearRgb(LIFE_WAVELENGTH_NM);
    const death = wavelengthToLinearRgb(DEATH_WAVELENGTH_NM);
    expect(life.b).toBeGreaterThan(life.r + life.g);
    expect(death.r).toBeGreaterThan(death.g + death.b);
  });

  it('maps out-of-gamut spectral values without changing channel order', () => {
    const mapped = gamutMapSpectralRgb({ r: 1.7, g: -0.3, b: 0.2 });
    expect(mapped.r).toBeGreaterThan(mapped.b);
    expect(mapped.b).toBeGreaterThan(mapped.g);
    expect(mapped.g).toBe(0);
    expect(mapped.r).toBe(1);
  });

  it('expands source chroma without changing the dominant channel', () => {
    expect(DEFAULT_SPECTRAL_CHROMA_GAIN).toBe(1.18);
    const base = wavelengthToLinearRgb(565, 1);
    const richer = wavelengthToLinearRgb(565, DEFAULT_SPECTRAL_CHROMA_GAIN);
    expect(dominantSeparation(richer)).toBeGreaterThan(dominantSeparation(base));
    expect(richer.g).toBe(Math.max(richer.r, richer.g, richer.b));
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

  it('boosts saturation while leaving neutral architecture unchanged', () => {
    expect(DEFAULT_OUTPUT_SATURATION).toBe(0.14);
    const color = { r: 0.08, g: 0.42, b: 1.4 };
    const richer = adjustLinearSaturation(color, DEFAULT_OUTPUT_SATURATION);
    expect(chroma(richer)).toBeGreaterThan(chroma(color));
    expect(adjustLinearSaturation({ r: 0.72, g: 0.72, b: 0.72 })).toEqual({
      r: 0.72,
      g: 0.72,
      b: 0.72,
    });
  });

  it('rolls HDR emission toward white while retaining internal detail', () => {
    const low = evaluateSpectralColor(LIFE_WAVELENGTH_NM, 0.5);
    const high = evaluateSpectralColor(LIFE_WAVELENGTH_NM, 8);
    expect(high.displayRgb.g).toBeGreaterThan(low.displayRgb.g);
    expect(high.displayRgb.r).toBeGreaterThan(low.displayRgb.r);
    expect(high.displayRgb.b).toBeGreaterThan(low.displayRgb.b);
    expect(new Set(Object.values(high.displayRgb).map((value) => value.toFixed(4))).size).toBeGreaterThan(1);
    expect(Math.max(...Object.values(high.displayRgb))).toBeLessThanOrEqual(1);
  });

  it('keeps intensity separate and deterministic for live/export consumers', () => {
    const first = spectralEmissionLinear(LIFE_WAVELENGTH_NM, 2.25);
    const second = spectralEmissionLinear(LIFE_WAVELENGTH_NM, 2.25);
    expect(first).toEqual(second);
    expectFiniteRgb(first);
  });
});
