import { DEFAULT_SPECTRAL_EXPOSURE } from './color';

export type SpectralLookName = 'porcelain' | 'technical' | 'ghost';

export interface SpectralLookProfile {
  name: SpectralLookName;
  label: string;
  exposure: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  emissionScale: number;
  outputSaturation: number;
}

export const SPECTRAL_LOOKS: Record<SpectralLookName, SpectralLookProfile> = {
  porcelain: {
    name: 'porcelain',
    label: 'Porcelain Spectrum',
    exposure: DEFAULT_SPECTRAL_EXPOSURE,
    bloomStrength: 0.34,
    bloomRadius: 0.12,
    bloomThreshold: 1.0,
    emissionScale: 1,
    outputSaturation: 0.18,
  },
  technical: {
    name: 'technical',
    label: 'Technical Wire',
    exposure: 0.94,
    bloomStrength: 0.14,
    bloomRadius: 0.08,
    bloomThreshold: 1.15,
    emissionScale: 0.58,
    outputSaturation: 0.1,
  },
  ghost: {
    name: 'ghost',
    label: 'Ghost Volume',
    exposure: 0.78,
    bloomStrength: 0.27,
    bloomRadius: 0.1,
    bloomThreshold: 0.95,
    emissionScale: 0.82,
    outputSaturation: 0.15,
  },
};

export function selectSpectralLook(value: string | null): SpectralLookProfile {
  if (value === 'technical' || value === 'ghost') return SPECTRAL_LOOKS[value];
  return SPECTRAL_LOOKS.porcelain;
}
