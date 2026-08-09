export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type SpatialObservationKind =
  | 'contact'
  | 'overlap'
  | 'ray-hit'
  | 'shape-hit';

export interface SpatialObservation {
  kind: SpatialObservationKind;
  sourceId: string;
  distance: number;
  point?: Vec3Like;
  normal?: Vec3Like;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface RayQuery {
  origin: Vec3Like;
  direction: Vec3Like;
  maxDistance: number;
}

export interface SphereQuery {
  center: Vec3Like;
  radius: number;
}

export interface SpatialQueryWorld {
  readonly kind: 'null' | 'jolt';
  readonly ready: boolean;
  raycast(query: RayQuery): readonly SpatialObservation[];
  overlapSphere(query: SphereQuery): readonly SpatialObservation[];
  step(dt: number): void;
  dispose(): void;
}
