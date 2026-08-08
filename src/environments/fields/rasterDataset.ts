import { f32, quantize, vec3 } from './math';
import type { Vec3 } from './math';
import type { FieldChannelManifest, FieldProvider, FieldProviderManifest, FieldSample } from './provider';
import { FieldProviderValidationError } from './provider';

export interface RasterScalarChannel {
  readonly id: string;
  readonly kind: 'scalar';
  readonly semantic?: string;
  readonly unit?: string;
  readonly values: readonly number[];
}

export interface RasterVectorChannel {
  readonly id: string;
  readonly kind: 'vector';
  readonly semantic?: string;
  readonly unit?: string;
  readonly values: readonly Vec3[];
}

export type RasterChannel = RasterScalarChannel | RasterVectorChannel;

export interface RasterDatasetManifest {
  readonly id: string;
  readonly providerId: string;
  readonly width: number;
  readonly height: number;
  readonly origin: Vec3;
  readonly cellSizeMeters: number;
  readonly outside?: 'clamp' | 'zero';
  readonly interpolation?: 'bilinear';
  readonly spatialFrame?: string;
  readonly sourceRef?: string;
  readonly checksum?: string;
  readonly channels: readonly RasterChannel[];
}

function assertDataset(dataset: RasterDatasetManifest): void {
  if (!dataset.id.trim()) throw new FieldProviderValidationError('dataset.id must be non-empty');
  if (!dataset.providerId.trim()) throw new FieldProviderValidationError(`dataset ${dataset.id}: providerId must be non-empty`);
  if (!Number.isInteger(dataset.width) || dataset.width < 2) throw new FieldProviderValidationError(`dataset ${dataset.id}: width must be an integer >= 2`);
  if (!Number.isInteger(dataset.height) || dataset.height < 2) throw new FieldProviderValidationError(`dataset ${dataset.id}: height must be an integer >= 2`);
  if (!(dataset.cellSizeMeters > 0) || !Number.isFinite(dataset.cellSizeMeters)) throw new FieldProviderValidationError(`dataset ${dataset.id}: cellSizeMeters must be finite and > 0`);
  const expected = dataset.width * dataset.height;
  const ids = new Set<string>();
  for (const channel of dataset.channels) {
    if (!channel.id.trim()) throw new FieldProviderValidationError(`dataset ${dataset.id}: channel.id must be non-empty`);
    if (ids.has(channel.id)) throw new FieldProviderValidationError(`dataset ${dataset.id}: duplicate channel ${channel.id}`);
    ids.add(channel.id);
    if (channel.values.length !== expected) throw new FieldProviderValidationError(`dataset ${dataset.id}: channel ${channel.id} expected ${expected} values, got ${channel.values.length}`);
  }
}

function index(width: number, x: number, z: number): number { return z * width + x; }
function lerp(a: number, b: number, t: number): number { return f32(a + f32((b - a) * t)); }

function bilinearScalar(values: readonly number[], width: number, x0: number, z0: number, x1: number, z1: number, tx: number, tz: number): number {
  const a = lerp(f32(values[index(width, x0, z0)] ?? 0), f32(values[index(width, x1, z0)] ?? 0), tx);
  const b = lerp(f32(values[index(width, x0, z1)] ?? 0), f32(values[index(width, x1, z1)] ?? 0), tx);
  return lerp(a, b, tz);
}

function bilinearVector(values: readonly Vec3[], width: number, x0: number, z0: number, x1: number, z1: number, tx: number, tz: number): Vec3 {
  const c = (i: number) => values[i] ?? vec3(0, 0, 0);
  const a = index(width, x0, z0); const b = index(width, x1, z0); const d = index(width, x0, z1); const e = index(width, x1, z1);
  return vec3(
    lerp(lerp(c(a).x, c(b).x, tx), lerp(c(d).x, c(e).x, tx), tz),
    lerp(lerp(c(a).y, c(b).y, tx), lerp(c(d).y, c(e).y, tx), tz),
    lerp(lerp(c(a).z, c(b).z, tx), lerp(c(d).z, c(e).z, tx), tz),
  );
}

export function createRasterDatasetProvider(dataset: RasterDatasetManifest): FieldProvider {
  assertDataset(dataset);
  const origin = quantize(dataset.origin);
  const cell = f32(dataset.cellSizeMeters);
  const outside = dataset.outside ?? 'clamp';
  const channels: FieldChannelManifest[] = dataset.channels.map((channel) => ({ id: channel.id, kind: channel.kind, semantic: channel.semantic, unit: channel.unit }));
  const manifest: FieldProviderManifest = { id: dataset.providerId, channels, spatialFrame: dataset.spatialFrame };

  const sample = (point: Vec3): FieldSample => {
    const q = quantize(point);
    let gx = f32((q.x - origin.x) / cell);
    let gz = f32((q.z - origin.z) / cell);
    const maxX = dataset.width - 1; const maxZ = dataset.height - 1;
    if (outside === 'zero' && (gx < 0 || gz < 0 || gx > maxX || gz > maxZ)) return { scalars: {}, vectors: {}, sourceIds: [dataset.id], contacts: [] };
    gx = Math.min(maxX, Math.max(0, gx)); gz = Math.min(maxZ, Math.max(0, gz));
    const x0 = Math.floor(gx); const z0 = Math.floor(gz); const x1 = Math.min(maxX, x0 + 1); const z1 = Math.min(maxZ, z0 + 1);
    const tx = f32(gx - x0); const tz = f32(gz - z0);
    const scalars: Record<string, number> = {}; const vectors: Record<string, Vec3> = {};
    for (const channel of dataset.channels) {
      if (channel.kind === 'scalar') scalars[channel.id] = bilinearScalar(channel.values, dataset.width, x0, z0, x1, z1, tx, tz);
      else vectors[channel.id] = bilinearVector(channel.values, dataset.width, x0, z0, x1, z1, tx, tz);
    }
    return { scalars: Object.freeze(scalars), vectors: Object.freeze(vectors), sourceIds: [dataset.id], contacts: [] };
  };

  return {
    manifest: Object.freeze({ ...manifest, channels: Object.freeze(channels) }),
    sample(point) { return sample(point); },
    sampleBatch(points) { return points.map(sample); },
  };
}
