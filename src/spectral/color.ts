const CIE_VISIBLE_WAVELENGTH_MIN_NM = 380;
const CIE_VISIBLE_WAVELENGTH_MAX_NM = 780;

export const SPECTRAL_CLAMP_MIN_NM = 470;
export const SPECTRAL_CLAMP_MAX_NM = 620;
export const LIFE_WAVELENGTH_NM = SPECTRAL_CLAMP_MIN_NM;
export const DEATH_WAVELENGTH_NM = SPECTRAL_CLAMP_MAX_NM;
export const DEFAULT_SPECTRAL_EXPOSURE = 0.86;
export const DEFAULT_SPECTRAL_CHROMA_GAIN = 1.32;
export const DEFAULT_OUTPUT_SATURATION = 0.18;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface SpectralColorSample {
  wavelengthNm: number;
  intensity: number;
  exposure: number;
  chromaGain: number;
  outputSaturation: number;
  linearRgb: Rgb;
  toneMappedLinearRgb: Rgb;
  displayRgb: Rgb;
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp01((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function asymmetricGaussian(
  wavelengthNm: number,
  mean: number,
  leftScale: number,
  rightScale: number,
): number {
  const offset = wavelengthNm - mean;
  const scaled = offset * (offset < 0 ? leftScale : rightScale);
  return Math.exp(-0.5 * scaled * scaled);
}

/**
 * Analytic CIE 1931 2° matching-function fit from Wyman, Sloan, and Shirley.
 * The fit is deterministic and continuous, so browser and export paths can use
 * the same wavelength contract without a sampled texture or hand-picked ramp.
 */
export function wavelengthToXyz(wavelengthNm: number): Rgb {
  if (
    !Number.isFinite(wavelengthNm) ||
    wavelengthNm < CIE_VISIBLE_WAVELENGTH_MIN_NM ||
    wavelengthNm > CIE_VISIBLE_WAVELENGTH_MAX_NM
  ) {
    return { ...BLACK };
  }

  const x =
    1.056 * asymmetricGaussian(wavelengthNm, 599.8, 0.0264, 0.0323) +
    0.362 * asymmetricGaussian(wavelengthNm, 442.0, 0.0624, 0.0374) -
    0.065 * asymmetricGaussian(wavelengthNm, 501.1, 0.049, 0.0382);
  const y =
    0.821 * asymmetricGaussian(wavelengthNm, 568.8, 0.0213, 0.0247) +
    0.286 * asymmetricGaussian(wavelengthNm, 530.9, 0.0613, 0.0322);
  const z =
    1.217 * asymmetricGaussian(wavelengthNm, 437.0, 0.0845, 0.0278) +
    0.681 * asymmetricGaussian(wavelengthNm, 459.0, 0.0385, 0.0725);

  return { r: Math.max(0, x), g: Math.max(0, y), b: Math.max(0, z) };
}

/** Clamp every authored emission to the approved blue-life → red-death band. */
export function clampSpectralWavelength(wavelengthNm: number): number {
  const safeWavelength = Number.isFinite(wavelengthNm) ? wavelengthNm : LIFE_WAVELENGTH_NM;
  return clamp(safeWavelength, SPECTRAL_CLAMP_MIN_NM, SPECTRAL_CLAMP_MAX_NM);
}

/** Map a normalized semantic state from life (0) to death (1). */
export function lifeDeathToWavelength(deathAmount: number): number {
  return LIFE_WAVELENGTH_NM +
    (DEATH_WAVELENGTH_NM - LIFE_WAVELENGTH_NM) * clamp01(deathAmount);
}

export function xyzToLinearSrgb(xyz: Rgb): Rgb {
  return {
    r: 3.2406 * xyz.r - 1.5372 * xyz.g - 0.4986 * xyz.b,
    g: -0.9689 * xyz.r + 1.8758 * xyz.g + 0.0415 * xyz.b,
    b: 0.0557 * xyz.r - 0.204 * xyz.g + 1.057 * xyz.b,
  };
}

/**
 * Spectral locus colors exceed the sRGB gamut. Adding the smallest neutral
 * component needed to remove negative channels preserves channel order, then a
 * peak normalization keeps intensity independent from wavelength.
 */
export function gamutMapSpectralRgb(color: Rgb): Rgb {
  const neutralLift = -Math.min(0, color.r, color.g, color.b);
  const lifted = {
    r: color.r + neutralLift,
    g: color.g + neutralLift,
    b: color.b + neutralLift,
  };
  const peak = Math.max(lifted.r, lifted.g, lifted.b);
  if (!Number.isFinite(peak) || peak <= 1e-8) return { ...BLACK };
  return { r: lifted.r / peak, g: lifted.g / peak, b: lifted.b / peak };
}

/**
 * Expand source chroma at constant peak intensity. The gamut-mapped spectral
 * locus already touches the sRGB boundary, so out-of-gamut channels are clipped
 * after expansion instead of adding neutral energy back into the color.
 */
export function boostSpectralChroma(
  color: Rgb,
  gain = DEFAULT_SPECTRAL_CHROMA_GAIN,
): Rgb {
  const safeGain = clamp(Number.isFinite(gain) ? gain : DEFAULT_SPECTRAL_CHROMA_GAIN, 1, 2);
  const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  const expanded = {
    r: Math.max(0, luminance + (color.r - luminance) * safeGain),
    g: Math.max(0, luminance + (color.g - luminance) * safeGain),
    b: Math.max(0, luminance + (color.b - luminance) * safeGain),
  };
  const peak = Math.max(expanded.r, expanded.g, expanded.b);
  if (!Number.isFinite(peak) || peak <= 1e-8) return { ...BLACK };
  const normalization = Math.max(1, peak);
  return {
    r: expanded.r / normalization,
    g: expanded.g / normalization,
    b: expanded.b / normalization,
  };
}

export function wavelengthToLinearRgb(
  wavelengthNm: number,
  chromaGain = DEFAULT_SPECTRAL_CHROMA_GAIN,
): Rgb {
  if (!Number.isFinite(wavelengthNm)) return { ...BLACK };
  const clampedWavelength = clampSpectralWavelength(wavelengthNm);
  const gamutMapped = gamutMapSpectralRgb(xyzToLinearSrgb(wavelengthToXyz(clampedWavelength)));
  return boostSpectralChroma(gamutMapped, chromaGain);
}

export function addRgb(first: Rgb, second: Rgb): Rgb {
  return {
    r: first.r + second.r,
    g: first.g + second.g,
    b: first.b + second.b,
  };
}

export function scaleRgb(color: Rgb, amount: number): Rgb {
  return {
    r: color.r * amount,
    g: color.g * amount,
    b: color.b * amount,
  };
}

export function mixLinearRgb(first: Rgb, second: Rgb, amount: number): Rgb {
  const mix = clamp01(amount);
  return {
    r: first.r + (second.r - first.r) * mix,
    g: first.g + (second.g - first.g) * mix,
    b: first.b + (second.b - first.b) * mix,
  };
}

export function spectralEmissionLinear(
  wavelengthNm: number,
  intensity: number,
  chromaGain = DEFAULT_SPECTRAL_CHROMA_GAIN,
): Rgb {
  const safeIntensity = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 16);
  const chroma = scaleRgb(wavelengthToLinearRgb(wavelengthNm, chromaGain), safeIntensity);
  const whiteAmount = smoothstep(4.25, 11, safeIntensity) * safeIntensity * 0.08;
  return addRgb(chroma, { r: whiteAmount, g: whiteAmount, b: whiteAmount });
}

/** Match the renderer's pre-ACES saturation pass for deterministic CPU output. */
export function adjustLinearSaturation(
  color: Rgb,
  saturation = DEFAULT_OUTPUT_SATURATION,
): Rgb {
  const safeSaturation = clamp(
    Number.isFinite(saturation) ? saturation : DEFAULT_OUTPUT_SATURATION,
    -1,
    0.5,
  );
  const average = (color.r + color.g + color.b) / 3;
  const scale = safeSaturation > 0
    ? 1 / (1.001 - safeSaturation)
    : 1 + safeSaturation;
  return {
    r: average + (color.r - average) * scale,
    g: average + (color.g - average) * scale,
    b: average + (color.b - average) * scale,
  };
}

function multiplyMatrix3(color: Rgb, matrix: readonly number[]): Rgb {
  return {
    r: (matrix[0] ?? 0) * color.r + (matrix[1] ?? 0) * color.g + (matrix[2] ?? 0) * color.b,
    g: (matrix[3] ?? 0) * color.r + (matrix[4] ?? 0) * color.g + (matrix[5] ?? 0) * color.b,
    b: (matrix[6] ?? 0) * color.r + (matrix[7] ?? 0) * color.g + (matrix[8] ?? 0) * color.b,
  };
}

const ACES_INPUT_MATRIX = [
  0.59719, 0.35458, 0.04823,
  0.076, 0.90834, 0.01566,
  0.0284, 0.13383, 0.83777,
] as const;

const ACES_OUTPUT_MATRIX = [
  1.60475, -0.53108, -0.07367,
  -0.10208, 1.10813, -0.00605,
  -0.00327, -0.07276, 1.07602,
] as const;

function rrtAndOdtFit(value: number): number {
  const numerator = value * (value + 0.0245786) - 0.000090537;
  const denominator = value * (0.983729 * value + 0.432951) + 0.238081;
  return numerator / Math.max(1e-8, denominator);
}

/** CPU equivalent of Three.js ACESFilmicToneMapping for readouts and tests. */
export function acesFilmicToneMap(color: Rgb, exposure = DEFAULT_SPECTRAL_EXPOSURE): Rgb {
  const exposed = scaleRgb(color, Math.max(0, exposure) / 0.6);
  const aces = multiplyMatrix3(exposed, ACES_INPUT_MATRIX);
  const fitted = {
    r: rrtAndOdtFit(aces.r),
    g: rrtAndOdtFit(aces.g),
    b: rrtAndOdtFit(aces.b),
  };
  const output = multiplyMatrix3(fitted, ACES_OUTPUT_MATRIX);
  return { r: clamp01(output.r), g: clamp01(output.g), b: clamp01(output.b) };
}

export function linearChannelToSrgb(value: number): number {
  const channel = Math.max(0, value);
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

export function srgbChannelToLinear(value: number): number {
  const channel = clamp01(value);
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(color: Rgb): Rgb {
  return {
    r: clamp01(linearChannelToSrgb(color.r)),
    g: clamp01(linearChannelToSrgb(color.g)),
    b: clamp01(linearChannelToSrgb(color.b)),
  };
}

export function srgbToLinear(color: Rgb): Rgb {
  return {
    r: srgbChannelToLinear(color.r),
    g: srgbChannelToLinear(color.g),
    b: srgbChannelToLinear(color.b),
  };
}

export function evaluateSpectralColor(
  wavelengthNm: number,
  intensity: number,
  exposure = DEFAULT_SPECTRAL_EXPOSURE,
  chromaGain = DEFAULT_SPECTRAL_CHROMA_GAIN,
  outputSaturation = DEFAULT_OUTPUT_SATURATION,
): SpectralColorSample {
  const safeWavelength = clampSpectralWavelength(wavelengthNm);
  const safeIntensity = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 16);
  const safeExposure = clamp(Number.isFinite(exposure) ? exposure : DEFAULT_SPECTRAL_EXPOSURE, 0, 4);
  const safeChromaGain = clamp(
    Number.isFinite(chromaGain) ? chromaGain : DEFAULT_SPECTRAL_CHROMA_GAIN,
    1,
    2,
  );
  const safeOutputSaturation = clamp(
    Number.isFinite(outputSaturation) ? outputSaturation : DEFAULT_OUTPUT_SATURATION,
    -1,
    0.5,
  );
  const linearRgb = spectralEmissionLinear(safeWavelength, safeIntensity, safeChromaGain);
  const gradedLinearRgb = adjustLinearSaturation(linearRgb, safeOutputSaturation);
  const toneMappedLinearRgb = acesFilmicToneMap(gradedLinearRgb, safeExposure);
  return {
    wavelengthNm: safeWavelength,
    intensity: safeIntensity,
    exposure: safeExposure,
    chromaGain: safeChromaGain,
    outputSaturation: safeOutputSaturation,
    linearRgb,
    toneMappedLinearRgb,
    displayRgb: linearToSrgb(toneMappedLinearRgb),
  };
}

export function rgbToCss(color: Rgb): string {
  const r = Math.round(clamp01(color.r) * 255);
  const g = Math.round(clamp01(color.g) * 255);
  const b = Math.round(clamp01(color.b) * 255);
  return `rgb(${r} ${g} ${b})`;
}

export function formatRgb(color: Rgb, precision = 3): string {
  return `${color.r.toFixed(precision)}, ${color.g.toFixed(precision)}, ${color.b.toFixed(precision)}`;
}
