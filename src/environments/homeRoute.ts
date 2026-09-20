import {
  selectHomePreset,
  type HomeCameraPreset,
  type HomeCameraRole,
  type HomePresetManifest,
} from './homePresets';

export interface HomeRouteState {
  readonly preset: HomePresetManifest;
  readonly camera: HomeCameraPreset;
}

const CAMERA_ROLES = new Set<HomeCameraRole>([
  'establishing',
  'orbit',
  'top-down',
  'macro',
]);

function cameraRole(value: string | null): HomeCameraRole {
  return value !== null && CAMERA_ROLES.has(value as HomeCameraRole)
    ? (value as HomeCameraRole)
    : 'establishing';
}

export function resolveHomeRoute(
  source: string | URLSearchParams,
): HomeRouteState {
  const params = typeof source === 'string' ? new URLSearchParams(source) : source;
  const preset = selectHomePreset(params.get('homePreset'));
  const role = cameraRole(params.get('homeCamera'));
  const camera =
    preset.cameras.find((candidate) => candidate.role === role) ??
    preset.cameras.find((candidate) => candidate.role === 'establishing');

  if (!camera) {
    throw new Error(`Home preset ${preset.id} has no establishing camera`);
  }
  return { preset, camera };
}

export function writeHomeRoute(
  params: URLSearchParams,
  preset: HomePresetManifest,
  camera: HomeCameraPreset,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set('homePreset', preset.id);
  next.set('homeCamera', camera.role);
  return next;
}
