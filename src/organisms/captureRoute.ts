import type { MorphologyLod, OrganismVisualState } from './types';

const CAPTURE_STATES = new Set<OrganismVisualState>([
  'dormant',
  'feeding',
  'starving',
  'damaged',
  'mutating',
  'dying',
  'death',
  'regenerating',
]);

export function parseRunSeed(value: string | null, fallback = 0x5350_4543): number {
  if (!value) return fallback >>> 0;
  const parsed = value.toLowerCase().startsWith('0x')
    ? Number.parseInt(value.slice(2), 16)
    : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed >>> 0 : fallback >>> 0;
}

export function parseCaptureTick(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(900, Math.max(0, Math.round(parsed)));
}

export function parseCaptureState(value: string | null): OrganismVisualState | undefined {
  return value && CAPTURE_STATES.has(value as OrganismVisualState)
    ? value as OrganismVisualState
    : undefined;
}

export function parseCaptureDistance(value: string | null): MorphologyLod | undefined {
  return value === 'overview' || value === 'mid' || value === 'macro' ? value : undefined;
}

export function parseNcaMode(value: string | null): 'live' | 'frozen' {
  return value === 'frozen' ? 'frozen' : 'live';
}
