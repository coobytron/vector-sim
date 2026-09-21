import {
  createCompositeFieldProvider,
  createShelterFieldProvider,
  createSignedFieldProvider,
  vec3,
  type EffectSource,
  type FieldProvider,
  type ShelterRegion,
  type Vec3,
} from './fields';

export type HomePresetId = 'courtyard-house' | 'domestic-section' | 'tabletop-habitat';
export type HomeCameraRole = 'establishing' | 'orbit' | 'top-down' | 'macro';

export interface HomeCameraPreset {
  readonly id: string;
  readonly role: HomeCameraRole;
  readonly position: Vec3;
  readonly target: Vec3;
  readonly fovDegrees: number;
}

export interface HomeSpawnRegion {
  readonly id: string;
  readonly center: Vec3;
  readonly halfExtentsMeters: Vec3;
  readonly capacity: number;
}

export type HomeShelterRegion = ShelterRegion;

export interface HomePresetManifest {
  readonly schemaVersion: 'home-preset.v1';
  readonly id: HomePresetId;
  readonly displayName: string;
  readonly seed: number;
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  readonly spawnRegions: readonly HomeSpawnRegion[];
  readonly cameras: readonly HomeCameraPreset[];
  readonly effectSources: readonly EffectSource[];
  readonly shelterRegions: readonly HomeShelterRegion[];
  readonly switchableEffectSourceId: string;
  readonly qualityDensity: {
    readonly mobile: { readonly architectureDetail: number; readonly decorativeBudget: number };
    readonly desktop: { readonly architectureDetail: number; readonly decorativeBudget: number };
  };
}

function sphereSource(
  id: string,
  strength: number,
  center: Vec3,
  rangeMeters = 0.72,
): EffectSource {
  return {
    id,
    strength,
    rangeMeters,
    geometry: { kind: 'sphere', center, radiusMeters: 0.12 },
  };
}

function camera(
  preset: HomePresetId,
  role: HomeCameraRole,
  position: Vec3,
  target: Vec3,
  fovDegrees: number,
): HomeCameraPreset {
  return { id: `${preset}-${role}`, role, position, target, fovDegrees };
}

function preset(args: Omit<HomePresetManifest, 'schemaVersion'>): HomePresetManifest {
  return { schemaVersion: 'home-preset.v1', ...args };
}

export const HOME_PRESETS: Readonly<Record<HomePresetId, HomePresetManifest>> = {
  'courtyard-house': preset({
    id: 'courtyard-house',
    displayName: 'Courtyard House',
    seed: 4101,
    bounds: { min: vec3(-5.4, 0, -4.2), max: vec3(5.4, 3.4, 4.2) },
    spawnRegions: [
      {
        id: 'courtyard-living-spawn',
        center: vec3(0, 0.28, 1.35),
        halfExtentsMeters: vec3(1.25, 0.22, 0.72),
        capacity: 8,
      },
    ],
    cameras: [
      camera('courtyard-house', 'establishing', vec3(6.4, 4.2, 7.3), vec3(0, 1.0, 0), 42),
      camera('courtyard-house', 'orbit', vec3(4.1, 2.7, 4.6), vec3(0, 0.9, 0), 42),
      camera('courtyard-house', 'top-down', vec3(0, 8.8, 0.01), vec3(0, 0, 0), 38),
      camera('courtyard-house', 'macro', vec3(2.4, 1.25, 2.1), vec3(1.1, 0.62, 0.55), 34),
    ],
    effectSources: [
      sphereSource('courtyard-window-feed', 0.78, vec3(1.75, 1.72, -2.12), 0.9),
      sphereSource('courtyard-outlet-hazard', -0.92, vec3(-2.65, 0.46, -0.82), 0.58),
      sphereSource('courtyard-switchable-conduit', 0.42, vec3(2.72, 0.2, 0.56), 0.68),
    ],
    shelterRegions: [
      {
        id: 'courtyard-under-stair-shelter',
        center: vec3(-2.28, 0.38, 1.05),
        halfExtentsMeters: vec3(0.7, 0.34, 0.72),
        strength: 0.72,
      },
    ],
    switchableEffectSourceId: 'courtyard-switchable-conduit',
    qualityDensity: {
      mobile: { architectureDetail: 0.62, decorativeBudget: 36 },
      desktop: { architectureDetail: 1, decorativeBudget: 96 },
    },
  }),
  'domestic-section': preset({
    id: 'domestic-section',
    displayName: 'Domestic Section',
    seed: 4102,
    bounds: { min: vec3(-4.8, 0, -3.4), max: vec3(4.8, 4.6, 3.4) },
    spawnRegions: [
      {
        id: 'section-living-spawn',
        center: vec3(-0.55, 0.34, 0.85),
        halfExtentsMeters: vec3(1.05, 0.24, 0.62),
        capacity: 8,
      },
    ],
    cameras: [
      camera('domestic-section', 'establishing', vec3(6.8, 4.0, 6.4), vec3(0, 1.45, 0), 40),
      camera('domestic-section', 'orbit', vec3(4.4, 3.1, 4.2), vec3(0, 1.35, 0), 42),
      camera('domestic-section', 'top-down', vec3(0, 9.2, 0.01), vec3(0, 0.8, 0), 36),
      camera('domestic-section', 'macro', vec3(-1.9, 1.45, 1.8), vec3(-0.8, 0.72, 0.45), 32),
    ],
    effectSources: [
      sphereSource('section-skylight-feed', 0.7, vec3(0.8, 2.65, -1.7), 0.94),
      sphereSource('section-appliance-hazard', -0.88, vec3(2.2, 0.72, 0.2), 0.64),
      sphereSource('section-switchable-vent', 0.36, vec3(-2.45, 1.22, -1.35), 0.76),
    ],
    shelterRegions: [
      {
        id: 'section-wall-cavity-shelter',
        center: vec3(-3.25, 1.0, 0.2),
        halfExtentsMeters: vec3(0.42, 0.92, 0.82),
        strength: 0.78,
      },
    ],
    switchableEffectSourceId: 'section-switchable-vent',
    qualityDensity: {
      mobile: { architectureDetail: 0.58, decorativeBudget: 32 },
      desktop: { architectureDetail: 1, decorativeBudget: 88 },
    },
  }),
  'tabletop-habitat': preset({
    id: 'tabletop-habitat',
    displayName: 'Tabletop Habitat',
    seed: 4103,
    bounds: { min: vec3(-3.4, 0, -2.6), max: vec3(3.4, 2.6, 2.6) },
    spawnRegions: [
      {
        id: 'tabletop-living-spawn',
        center: vec3(0, 0.42, 0.2),
        halfExtentsMeters: vec3(0.82, 0.24, 0.62),
        capacity: 6,
      },
    ],
    cameras: [
      camera('tabletop-habitat', 'establishing', vec3(4.5, 2.8, 4.8), vec3(0, 0.72, 0), 42),
      camera('tabletop-habitat', 'orbit', vec3(3.2, 2.0, 3.1), vec3(0, 0.68, 0), 40),
      camera('tabletop-habitat', 'top-down', vec3(0, 6.6, 0.01), vec3(0, 0.35, 0), 34),
      camera('tabletop-habitat', 'macro', vec3(1.65, 1.1, 1.55), vec3(0.62, 0.5, 0.2), 30),
    ],
    effectSources: [
      sphereSource('tabletop-water-feed', 0.74, vec3(-1.25, 0.38, -0.5), 0.7),
      sphereSource('tabletop-hot-edge-hazard', -0.9, vec3(1.45, 0.34, -0.9), 0.56),
      sphereSource('tabletop-switchable-node', 0.4, vec3(0.86, 0.5, 0.78), 0.66),
    ],
    shelterRegions: [
      {
        id: 'tabletop-overhang-shelter',
        center: vec3(-0.55, 0.44, 1.0),
        halfExtentsMeters: vec3(0.58, 0.3, 0.5),
        strength: 0.68,
      },
    ],
    switchableEffectSourceId: 'tabletop-switchable-node',
    qualityDensity: {
      mobile: { architectureDetail: 0.66, decorativeBudget: 28 },
      desktop: { architectureDetail: 1, decorativeBudget: 72 },
    },
  }),
};

export function selectHomePreset(id: string | null | undefined): HomePresetManifest {
  if (id && Object.hasOwn(HOME_PRESETS, id)) return HOME_PRESETS[id as HomePresetId];
  return HOME_PRESETS['courtyard-house'];
}

export function createHomePresetFieldProvider(presetManifest: HomePresetManifest): FieldProvider {
  const id = `spectral-home/${presetManifest.id}`;
  return createCompositeFieldProvider(id, [
    createSignedFieldProvider(`${id}/effects`, presetManifest.effectSources),
    createShelterFieldProvider(`${id}/shelter`, presetManifest.shelterRegions),
  ]);
}

export function withHomeEffectStrength(
  presetManifest: HomePresetManifest,
  sourceId: string,
  strength: number,
): HomePresetManifest {
  if (!Number.isFinite(strength) || strength < -1 || strength > 1) {
    throw new RangeError('Home effect strength must be finite and within [-1, 1]');
  }
  let found = false;
  const effectSources = presetManifest.effectSources.map((source) => {
    if (source.id !== sourceId) return source;
    found = true;
    return { ...source, strength };
  });
  if (!found) throw new Error(`Unknown Home effect source: ${sourceId}`);
  return { ...presetManifest, effectSources };
}
