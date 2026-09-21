import type { HomePresetId, HomePresetManifest } from './homePresets';

export type HomeBoxMaterial = 'porcelain' | 'porcelain-light';
export type HomeGeometryRole =
  | 'floor'
  | 'wall'
  | 'aperture'
  | 'threshold'
  | 'stair'
  | 'furniture'
  | 'perimeter'
  | 'conduit'
  | 'utility';

export interface HomeBoxPart {
  readonly kind: 'box';
  readonly id: string;
  readonly role: HomeGeometryRole;
  readonly size: readonly [number, number, number];
  readonly position: readonly [number, number, number];
  readonly material: HomeBoxMaterial;
  readonly fieldSourceId?: string;
}

export interface HomeFramePart {
  readonly kind: 'frame';
  readonly id: string;
  readonly role: 'aperture' | 'utility';
  readonly size: readonly [number, number, number];
  readonly position: readonly [number, number, number];
  readonly fieldSourceId?: string;
}

export interface HomePolylinePart {
  readonly kind: 'polyline';
  readonly id: string;
  readonly role: 'conduit' | 'utility';
  readonly points: readonly (readonly [number, number, number])[];
  readonly fieldSourceId?: string;
}

export type HomeGeometryPart = HomeBoxPart | HomeFramePart | HomePolylinePart;

function box(
  id: string,
  role: HomeGeometryRole,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  material: HomeBoxMaterial = 'porcelain',
  fieldSourceId?: string,
): HomeBoxPart {
  return { kind: 'box', id, role, size, position, material, fieldSourceId };
}

function frame(
  id: string,
  role: 'aperture' | 'utility',
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  fieldSourceId?: string,
): HomeFramePart {
  return { kind: 'frame', id, role, size, position, fieldSourceId };
}

function polyline(
  id: string,
  role: 'conduit' | 'utility',
  points: readonly (readonly [number, number, number])[],
  fieldSourceId?: string,
): HomePolylinePart {
  return { kind: 'polyline', id, role, points, fieldSourceId };
}

function stairs(
  prefix: string,
  start: readonly [number, number, number],
  direction: readonly [number, number, number],
  count: number,
): HomeBoxPart[] {
  const result: HomeBoxPart[] = [];
  for (let step = 0; step < count; step += 1) {
    result.push(
      box(
        `${prefix}-${step + 1}`,
        'stair',
        [0.9, 0.18, 0.42],
        [
          start[0] + direction[0] * step,
          start[1] + direction[1] * step,
          start[2] + direction[2] * step,
        ],
      ),
    );
  }
  return result;
}

function courtyardHouse(manifest: HomePresetManifest): HomeGeometryPart[] {
  return [
    box('courtyard-floor', 'floor', [6.4, 0.12, 4.8], [0, -0.06, 0]),
    box('courtyard-north-wall', 'wall', [6.4, 3.2, 0.12], [0, 1.6, -2.34]),
    box('courtyard-west-wall', 'wall', [0.12, 3.2, 4.8], [-3.14, 1.6, 0]),
    box('courtyard-yard-edge', 'perimeter', [6.9, 0.11, 0.16], [0, 0.02, 2.48], 'porcelain-light'),
    box('courtyard-tabletop', 'furniture', [1.8, 0.11, 0.8], [0.8, 0.76, -0.6], 'porcelain-light'),
    box('courtyard-table-leg-a', 'furniture', [0.11, 0.75, 0.11], [0.1, 0.375, -0.9]),
    box('courtyard-table-leg-b', 'furniture', [0.11, 0.75, 0.11], [1.5, 0.375, -0.3]),
    ...stairs('courtyard-stair', [-2.3, 0.09, 1.5], [0, 0.18, -0.38], 5),
    frame(
      'courtyard-window-aperture',
      'aperture',
      [1.45, 1.1, 0.03],
      [1.7, 1.85, -2.24],
      'courtyard-window-feed',
    ),
    box(
      'courtyard-threshold',
      'threshold',
      [0.85, 0.025, 0.16],
      [2.7, 0.02, 0.55],
      'porcelain-light',
      manifest.switchableEffectSourceId,
    ),
    box('courtyard-outlet', 'utility', [0.18, 0.22, 0.05], [-3.03, 0.46, -0.82], 'porcelain-light', 'courtyard-outlet-hazard'),
    polyline(
      'courtyard-conduit',
      'conduit',
      [[2.25, 0.15, 0.55], [2.72, 0.2, 0.56], [2.95, 0.42, 0.56]],
      manifest.switchableEffectSourceId,
    ),
  ];
}

function domesticSection(manifest: HomePresetManifest): HomeGeometryPart[] {
  return [
    box('section-floor', 'floor', [7.0, 0.12, 4.4], [0, -0.06, 0]),
    box('section-rear-wall', 'wall', [7.0, 4.1, 0.12], [0, 2.05, -2.14]),
    box('section-side-wall', 'wall', [0.12, 4.1, 4.4], [-3.44, 2.05, 0]),
    box('section-upper-slab', 'floor', [3.1, 0.12, 2.1], [-1.8, 2.08, 0.85]),
    box('section-counter', 'furniture', [2.2, 0.16, 0.72], [1.65, 0.86, 0.15], 'porcelain-light'),
    box('section-appliance', 'utility', [0.8, 0.9, 0.72], [2.2, 0.45, 0.2], 'porcelain-light', 'section-appliance-hazard'),
    box('section-landing', 'threshold', [1.25, 0.08, 0.68], [-1.8, 1.03, 0.9], 'porcelain-light'),
    ...stairs('section-stair', [-2.45, 0.09, 1.6], [0.28, 0.2, -0.34], 7),
    frame('section-skylight', 'aperture', [1.7, 0.9, 0.04], [0.8, 2.65, -2.04], 'section-skylight-feed'),
    frame('section-vent', 'utility', [0.72, 0.5, 0.03], [-2.45, 1.22, -2.05], manifest.switchableEffectSourceId),
    polyline(
      'section-service-conduit',
      'conduit',
      [[-2.45, 1.22, -2.0], [-2.45, 1.22, -1.35], [-1.6, 1.22, -1.35]],
      manifest.switchableEffectSourceId,
    ),
  ];
}

function tabletopHabitat(manifest: HomePresetManifest): HomeGeometryPart[] {
  return [
    box('tabletop-plinth', 'floor', [5.4, 0.18, 3.8], [0, 0, 0]),
    box('tabletop-backplane', 'wall', [5.4, 2.1, 0.1], [0, 1.05, -1.84]),
    box('tabletop-perimeter-a', 'perimeter', [5.5, 0.14, 0.12], [0, 0.12, 1.86], 'porcelain-light'),
    box('tabletop-perimeter-b', 'perimeter', [0.12, 0.14, 3.8], [-2.69, 0.12, 0], 'porcelain-light'),
    box('tabletop-island-a', 'furniture', [1.1, 0.48, 0.9], [-0.85, 0.33, -0.35], 'porcelain-light'),
    box('tabletop-island-b', 'furniture', [0.85, 0.72, 0.75], [0.75, 0.45, 0.4]),
    box('tabletop-overhang', 'furniture', [1.4, 0.12, 0.82], [-0.55, 0.92, 1.0], 'porcelain-light'),
    box('tabletop-bridge', 'threshold', [1.35, 0.08, 0.36], [0.15, 0.58, 0.1], 'porcelain-light'),
    ...stairs('tabletop-step', [1.82, 0.09, 0.98], [-0.24, 0.13, -0.18], 4),
    frame('tabletop-water-frame', 'aperture', [0.78, 0.06, 0.78], [-1.25, 0.21, -0.5], 'tabletop-water-feed'),
    box('tabletop-hot-edge', 'utility', [0.82, 0.1, 0.12], [1.45, 0.28, -0.9], 'porcelain-light', 'tabletop-hot-edge-hazard'),
    polyline(
      'tabletop-switchable-conduit',
      'conduit',
      [[0.25, 0.34, 0.78], [0.86, 0.5, 0.78], [1.2, 0.7, 0.62]],
      manifest.switchableEffectSourceId,
    ),
  ];
}

export function createHomeGeometryParts(manifest: HomePresetManifest): readonly HomeGeometryPart[] {
  switch (manifest.id) {
    case 'courtyard-house':
      return courtyardHouse(manifest);
    case 'domestic-section':
      return domesticSection(manifest);
    case 'tabletop-habitat':
      return tabletopHabitat(manifest);
  }
}

export type HomeQualityDensityName = keyof HomePresetManifest['qualityDensity'];

const ALWAYS_VISIBLE_ROLES = new Set<HomeGeometryRole>([
  'floor',
  'wall',
  'perimeter',
  'threshold',
]);

export function selectHomeGeometryParts(
  manifest: HomePresetManifest,
  quality: HomeQualityDensityName,
): readonly HomeGeometryPart[] {
  const parts = createHomeGeometryParts(manifest);
  const density = manifest.qualityDensity[quality];

  const requiredIds = new Set(
    parts
      .filter((part) => ALWAYS_VISIBLE_ROLES.has(part.role) || Boolean(part.fieldSourceId))
      .map((part) => part.id),
  );
  const optionalParts = parts.filter((part) => !requiredIds.has(part.id));
  const optionalTarget = Math.min(
    optionalParts.length,
    density.decorativeBudget,
    Math.ceil(optionalParts.length * density.architectureDetail),
  );

  for (const part of optionalParts.slice(0, optionalTarget)) {
    requiredIds.add(part.id);
  }

  return parts.filter((part) => requiredIds.has(part.id));
}

export function homeGeometrySignature(parts: readonly HomeGeometryPart[]): string {
  return parts
    .map((part) => {
      if (part.kind === 'polyline') {
        return `${part.kind}:${part.id}:${part.role}:${part.points.map((point) => point.join(',')).join(';')}:${part.fieldSourceId ?? '-'}`;
      }
      return `${part.kind}:${part.id}:${part.role}:${part.size.join(',')}:${part.position.join(',')}:${part.fieldSourceId ?? '-'}`;
    })
    .join('|');
}

export function supportedHomeGeometryPresets(): readonly HomePresetId[] {
  return ['courtyard-house', 'domestic-section', 'tabletop-habitat'];
}
