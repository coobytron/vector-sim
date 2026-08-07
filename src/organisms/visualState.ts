import { LIFE_WAVELENGTH_NM } from '../spectral/color';
import { sampleSpectralEvent, type SpectralEvent } from '../spectral/events';
import {
  NODE_ROLE,
  type DecodedCellVisual,
  type OrganismVisualState,
  type VisualDecodeInput,
} from './types';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function resolveState(input: VisualDecodeInput): OrganismVisualState {
  if (input.stateOverride) return input.stateOverride;
  if (input.health <= 0.015) return 'death';
  if (input.health < 0.2) return 'dying';
  if (input.health < 0.72) return 'damaged';
  if (input.health > input.previousHealth + 0.0004) return 'regenerating';
  if (input.energy > 0.72) return 'feeding';
  if (input.energy < 0.25) return 'starving';
  return 'dormant';
}

function eventForState(state: OrganismVisualState): SpectralEvent | undefined {
  switch (state) {
    case 'feeding':
      return 'feeding';
    case 'damaged':
    case 'dying':
      return 'damage';
    case 'mutating':
      return 'mutation';
    case 'death':
      return 'death';
    case 'regenerating':
      return 'regeneration';
    case 'dormant':
    case 'starving':
      return undefined;
  }
}

function stateFormScale(state: OrganismVisualState): number {
  switch (state) {
    case 'feeding':
      return 1.14;
    case 'starving':
      return 0.64;
    case 'damaged':
      return 0.86;
    case 'mutating':
      return 1.08;
    case 'dying':
      return 0.58;
    case 'death':
      return 0.34;
    case 'regenerating':
      return 0.96;
    case 'dormant':
      return 1;
  }
}

function stateConnectivity(state: OrganismVisualState): number {
  switch (state) {
    case 'damaged':
      return 0.68;
    case 'dying':
      return 0.34;
    case 'death':
      return 0.08;
    case 'regenerating':
      return 0.78;
    case 'starving':
      return 0.82;
    case 'dormant':
    case 'feeding':
    case 'mutating':
      return 1;
  }
}

function roleScale(role: number): number {
  switch (role) {
    case NODE_ROLE.core:
      return 1.34;
    case NODE_ROLE.junction:
      return 1.18;
    case NODE_ROLE.terminal:
      return 1.08;
    default:
      return 1;
  }
}

export function decodeCellVisual(
  input: VisualDecodeInput,
  output: DecodedCellVisual,
): DecodedCellVisual {
  const state = resolveState(input);
  const activity = clamp01(input.activity);
  const formScale = stateFormScale(state);
  const integrity = 0.35 + clamp01(input.health) * 0.65;
  const thicknessSignal = clamp(input.thicknessSignal, -1, 1);
  const connectionSignal = clamp01(0.62 + input.connectivitySignal * 0.38);
  const event = eventForState(state);
  const semantic = event ? sampleSpectralEvent(event, input.phase) : undefined;
  const eventStrength = semantic?.intensityScale ?? 0;
  const stateStrength = state === 'death'
    ? 1
    : state === 'dying'
      ? 0.88
      : state === 'damaged'
        ? 0.72
        : state === 'regenerating'
          ? 0.82
          : state === 'mutating'
            ? 0.62
            : state === 'feeding'
              ? 0.58 + clamp01(input.energy - 0.72) * 1.4
              : 0;

  output.state = state;
  output.thickness = (0.72 + thicknessSignal * 0.24) * formScale * integrity * roleScale(input.role);
  output.curvature = clamp(input.curvatureSignal, -1, 1) * 0.055 +
    (state === 'damaged' || state === 'dying' ? Math.sin(input.phase * Math.PI * 2) * 0.025 : 0);
  output.opacity = clamp01((0.42 + activity * 0.58) * (state === 'death' ? 0.48 : 1));
  output.connectivity = clamp01(stateConnectivity(state) * connectionSignal);
  output.ribbonWeight = clamp01(
    (0.35 + activity * 0.65) * (state === 'starving' ? 0.45 : 1) * integrity,
  );
  output.baseTone = clamp01(0.72 + integrity * 0.22 + activity * 0.06);
  output.wavelengthNm = semantic?.wavelengthNm ?? LIFE_WAVELENGTH_NM;
  output.emissionStrength = clamp01(stateStrength * eventStrength);
  return output;
}

export function createDecodedCellVisual(): DecodedCellVisual {
  return {
    state: 'dormant',
    thickness: 1,
    curvature: 0,
    opacity: 1,
    connectivity: 1,
    ribbonWeight: 0.5,
    baseTone: 0.9,
    wavelengthNm: LIFE_WAVELENGTH_NM,
    emissionStrength: 0,
  };
}
