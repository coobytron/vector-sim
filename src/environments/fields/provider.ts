import { f32, quantize, vec3 } from './math';
import type { Vec3 } from './math';
import { createSignedEffectField } from './signedField';
import type { EffectSource, FieldContact } from './types';

export type FieldChannelKind = 'scalar' | 'vector';

export interface FieldChannelManifest {
  readonly id: string;
  readonly kind: FieldChannelKind;
  readonly semantic?: string;
  readonly unit?: string;
}

export interface FieldProviderManifest {
  readonly id: string;
  readonly channels: readonly FieldChannelManifest[];
  readonly spatialFrame?: string;
  readonly timeDomain?: { readonly start?: number; readonly end?: number; readonly unit?: string };
}

export interface FieldSample {
  readonly scalars: Readonly<Record<string, number>>;
  readonly vectors: Readonly<Record<string, Vec3>>;
  readonly sourceIds: readonly string[];
  readonly contacts: readonly FieldContact[];
  /** Optional causal context per channel, so opposing effects retain their own contacts. */
  readonly channelContexts?: Readonly<Record<string, {
    readonly sourceIds: readonly string[];
    readonly contacts: readonly FieldContact[];
  }>>;
}

export interface FieldProvider {
  readonly manifest: FieldProviderManifest;
  sample(point: Vec3, time?: number): FieldSample;
  sampleBatch(points: readonly Vec3[], time?: number): readonly FieldSample[];
}

export class FieldProviderValidationError extends Error {}

/** Axis-aligned volume with uniform shelter strength, including its boundary. */
export interface ShelterRegion {
  readonly id: string;
  readonly center: Vec3;
  readonly halfExtentsMeters: Vec3;
  readonly strength: number;
}

export function createShelterFieldProvider(id: string, regions: readonly ShelterRegion[]): FieldProvider {
  const seen = new Set<string>();
  const ordered = regions.map((region) => {
    if (!region.id.trim() || seen.has(region.id)) {
      throw new FieldProviderValidationError(`provider ${id}: invalid or duplicate shelter id ${region.id}`);
    }
    seen.add(region.id);
    if (!Number.isFinite(region.strength) || region.strength < 0 || region.strength > 1) {
      throw new FieldProviderValidationError(`provider ${id}: shelter ${region.id} strength must be within [0, 1]`);
    }
    for (const axis of ['x', 'y', 'z'] as const) {
      if (!Number.isFinite(f32(region.center[axis])) ||
          !Number.isFinite(f32(region.halfExtentsMeters[axis])) || region.halfExtentsMeters[axis] < 0) {
        throw new FieldProviderValidationError(`provider ${id}: shelter ${region.id} requires finite coordinates and nonnegative extents`);
      }
    }
    return { id: region.id, center: quantize(region.center),
      halfExtentsMeters: quantize(region.halfExtentsMeters), strength: f32(region.strength) };
  }).sort(compareId);
  return withBatch({ id, channels: [{ id: 'shelter', kind: 'scalar', semantic: 'idle-drain-reduction' }] }, (point) => {
    let complement = 1;
    const sourceIds: string[] = [];
    for (const region of ordered) {
      if (region.strength > 0 && (['x', 'y', 'z'] as const).every((axis) =>
        Math.abs(f32(point[axis] - region.center[axis])) <= region.halfExtentsMeters[axis])) {
        complement = f32(complement * f32(1 - region.strength));
        sourceIds.push(region.id);
      }
    }
    return { scalars: { shelter: f32(1 - complement) }, vectors: {}, sourceIds, contacts: [],
      channelContexts: { shelter: { sourceIds, contacts: [] } } };
  });
}

function compareId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareContact(a: FieldContact, b: FieldContact): number {
  return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
}

export function assertValidProviderManifest(manifest: FieldProviderManifest): void {
  if (!manifest.id.trim()) throw new FieldProviderValidationError('provider.id must be non-empty');
  const seen = new Set<string>();
  for (const channel of manifest.channels) {
    if (!channel.id.trim()) throw new FieldProviderValidationError(`provider ${manifest.id}: channel.id must be non-empty`);
    if (seen.has(channel.id)) throw new FieldProviderValidationError(`provider ${manifest.id}: duplicate channel id ${channel.id}`);
    seen.add(channel.id);
    if (channel.kind !== 'scalar' && channel.kind !== 'vector') {
      throw new FieldProviderValidationError(`provider ${manifest.id}: channel ${channel.id} has invalid kind`);
    }
  }
}

function freezeSample(sample: FieldSample): FieldSample {
  return Object.freeze({
    scalars: Object.freeze({ ...sample.scalars }),
    vectors: Object.freeze({ ...sample.vectors }),
    sourceIds: Object.freeze([...sample.sourceIds].sort()),
    contacts: Object.freeze([...sample.contacts].sort(compareContact)),
    ...(sample.channelContexts ? {
      channelContexts: Object.freeze(Object.fromEntries(Object.entries(sample.channelContexts).map(([id, context]) => [id, Object.freeze({
        sourceIds: Object.freeze([...context.sourceIds].sort()),
        contacts: Object.freeze([...context.contacts].sort(compareContact)),
      })]))),
    } : {}),
  });
}

function withBatch(manifest: FieldProviderManifest, sampler: (point: Vec3, time: number) => FieldSample): FieldProvider {
  assertValidProviderManifest(manifest);
  const frozenManifest = Object.freeze({ ...manifest, channels: Object.freeze([...manifest.channels].sort(compareId)) });
  return {
    manifest: frozenManifest,
    sample(point, time = 0) {
      return freezeSample(sampler(quantize(point), f32(time)));
    },
    sampleBatch(points, time = 0) {
      return points.map((point) => freezeSample(sampler(quantize(point), f32(time))));
    },
  };
}

export function createSignedFieldProvider(id: string, sources: readonly EffectSource[]): FieldProvider {
  const signed = createSignedEffectField(sources);
  const manifest: FieldProviderManifest = {
    id,
    channels: [
      { id: 'danger', kind: 'scalar', semantic: 'toxicity' },
      { id: 'energy', kind: 'scalar', semantic: 'nutrition' },
      { id: 'netEffect', kind: 'scalar', semantic: 'signed-effect-compatibility' },
    ],
  };
  return withBatch(manifest, (point) => {
    const sample = signed.sample(point);
    const contacts = [sample.foodContact, sample.killContact].filter((value): value is FieldContact => value !== null);
    return {
      scalars: { energy: sample.food, danger: sample.kill, netEffect: sample.netEffect },
      vectors: {},
      sourceIds: sample.contributingSourceIds,
      contacts,
      channelContexts: {
        energy: { sourceIds: sample.foodSourceIds, contacts: sample.foodContact ? [sample.foodContact] : [] },
        danger: { sourceIds: sample.killSourceIds, contacts: sample.killContact ? [sample.killContact] : [] },
      },
    };
  });
}

export function createRadialScalarProvider(options: {
  readonly id: string;
  readonly channelId: string;
  readonly center: Vec3;
  readonly radiusMeters: number;
  readonly peak?: number;
}): FieldProvider {
  if (!(options.radiusMeters > 0) || !Number.isFinite(options.radiusMeters)) {
    throw new FieldProviderValidationError(`provider ${options.id}: radiusMeters must be finite and > 0`);
  }
  const center = quantize(options.center);
  const radius = f32(options.radiusMeters);
  const peak = f32(options.peak ?? 1);
  return withBatch({ id: options.id, channels: [{ id: options.channelId, kind: 'scalar' }] }, (point) => {
    const dx = f32(point.x - center.x);
    const dy = f32(point.y - center.y);
    const dz = f32(point.z - center.z);
    const distance = f32(Math.hypot(dx, dy, dz));
    const value = f32(peak * Math.max(0, 1 - distance / radius));
    return { scalars: { [options.channelId]: value }, vectors: {}, sourceIds: [options.id], contacts: [] };
  });
}

export function createUniformVectorProvider(options: {
  readonly id: string;
  readonly channelId: string;
  readonly vector: Vec3;
}): FieldProvider {
  const vector = vec3(options.vector.x, options.vector.y, options.vector.z);
  return withBatch({ id: options.id, channels: [{ id: options.channelId, kind: 'vector' }] }, () => ({
    scalars: {}, vectors: { [options.channelId]: vector }, sourceIds: [options.id], contacts: [],
  }));
}

export function createCompositeFieldProvider(id: string, providers: readonly FieldProvider[]): FieldProvider {
  const ordered = [...providers].sort((a, b) => compareId(a.manifest, b.manifest));
  const channels = ordered.flatMap((provider) => provider.manifest.channels);
  const seen = new Set<string>();
  for (const channel of channels) {
    if (seen.has(channel.id)) throw new FieldProviderValidationError(`provider ${id}: duplicate composed channel id ${channel.id}`);
    seen.add(channel.id);
  }
  return withBatch({ id, channels }, (point, time) => {
    const scalars: Record<string, number> = {};
    const vectors: Record<string, Vec3> = {};
    const sourceIds: string[] = [];
    const contacts: FieldContact[] = [];
    const channelContexts: NonNullable<FieldSample['channelContexts']> = {};
    for (const provider of ordered) {
      const sample = provider.sample(point, time);
      Object.assign(scalars, sample.scalars);
      Object.assign(vectors, sample.vectors);
      sourceIds.push(...sample.sourceIds);
      contacts.push(...sample.contacts);
      Object.assign(channelContexts, sample.channelContexts);
    }
    return { scalars, vectors, sourceIds, contacts, channelContexts };
  });
}
