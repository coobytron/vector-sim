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
}

export interface FieldProvider {
  readonly manifest: FieldProviderManifest;
  sample(point: Vec3, time?: number): FieldSample;
  sampleBatch(points: readonly Vec3[], time?: number): readonly FieldSample[];
}

export class FieldProviderValidationError extends Error {}

function compareId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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
    contacts: Object.freeze([...sample.contacts].sort(compareId)),
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
    const dx = f32(point.x - center.x); const dy = f32(point.y - center.y); const dz = f32(point.z - center.z);
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
    for (const provider of ordered) {
      const sample = provider.sample(point, time);
      Object.assign(scalars, sample.scalars);
      Object.assign(vectors, sample.vectors);
      sourceIds.push(...sample.sourceIds);
      contacts.push(...sample.contacts);
    }
    return { scalars, vectors, sourceIds, contacts };
  });
}
