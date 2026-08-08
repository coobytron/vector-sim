import { describe, expect, it } from 'vitest';
import {
  FieldProviderValidationError,
  createCompositeFieldProvider,
  createRadialScalarProvider,
  createSignedFieldProvider,
  createUniformVectorProvider,
  vec3,
} from '../src/environments/fields';
import type { EffectSource } from '../src/environments/fields';

const signedSources: EffectSource[] = [
  { id: 'food-a', strength: 1, rangeMeters: 2, geometry: { kind: 'point', position: vec3(0, 0, 0) } },
  { id: 'kill-b', strength: -0.5, rangeMeters: 2, geometry: { kind: 'point', position: vec3(1, 0, 0) } },
];

describe('generalized field providers', () => {
  it('wraps the signed field without changing its compatibility semantics', () => {
    const provider = createSignedFieldProvider('signed', signedSources);
    const sample = provider.sample(vec3(0, 0, 0));
    expect(sample.scalars.energy).toBe(1);
    expect(sample.scalars.danger).toBeGreaterThan(0);
    expect(sample.scalars.netEffect).toBe(sample.scalars.energy! - sample.scalars.danger!);
    expect(sample.sourceIds).toEqual(['food-a', 'kill-b']);
  });

  it('allows scalar and vector channels in the same composite contract', () => {
    const scalar = createRadialScalarProvider({ id: 'heat', channelId: 'temperature', center: vec3(0, 0, 0), radiusMeters: 4, peak: 1 });
    const vector = createUniformVectorProvider({ id: 'wind', channelId: 'flow', vector: vec3(1, 2, 3) });
    const composite = createCompositeFieldProvider('habitat', [vector, scalar]);
    expect(composite.manifest.channels.map((channel) => [channel.id, channel.kind])).toEqual([
      ['flow', 'vector'],
      ['temperature', 'scalar'],
    ]);
    const sample = composite.sample(vec3(0, 0, 0));
    expect(sample.scalars.temperature).toBe(1);
    expect(sample.vectors.flow).toEqual(vec3(1, 2, 3));
  });

  it('is deterministic when composite provider declaration order changes', () => {
    const a = createRadialScalarProvider({ id: 'a', channelId: 'temperature', center: vec3(0, 0, 0), radiusMeters: 4 });
    const b = createUniformVectorProvider({ id: 'b', channelId: 'flow', vector: vec3(0.25, 0, -1) });
    const point = vec3(1.125, -0.25, 0.5);
    expect(JSON.stringify(createCompositeFieldProvider('x', [a, b]).sample(point))).toBe(
      JSON.stringify(createCompositeFieldProvider('x', [b, a]).sample(point)),
    );
  });

  it('batch sampling preserves point order and float32-stable output', () => {
    const provider = createRadialScalarProvider({ id: 'light', channelId: 'light', center: vec3(0, 0, 0), radiusMeters: 2 });
    const points = [vec3(0, 0, 0), vec3(1, 0, 0), vec3(3, 0, 0)];
    const samples = provider.sampleBatch(points);
    expect(samples.map((sample) => sample.scalars.light)).toEqual([1, 0.5, 0]);
    expect(JSON.stringify(provider.sampleBatch(points))).toBe(JSON.stringify(provider.sampleBatch(points)));
  });

  it('rejects duplicate composed channel IDs with provider context', () => {
    const a = createRadialScalarProvider({ id: 'a', channelId: 'same', center: vec3(0, 0, 0), radiusMeters: 1 });
    const b = createUniformVectorProvider({ id: 'b', channelId: 'same', vector: vec3(1, 0, 0) });
    expect(() => createCompositeFieldProvider('bad-composite', [a, b])).toThrow(FieldProviderValidationError);
    expect(() => createCompositeFieldProvider('bad-composite', [a, b])).toThrow(/bad-composite.*same/);
  });

  it('supports identical consumer code across provider implementations', () => {
    const providers = [
      createRadialScalarProvider({ id: 'light', channelId: 'light', center: vec3(0, 0, 0), radiusMeters: 3 }),
      createUniformVectorProvider({ id: 'flow', channelId: 'flow', vector: vec3(0, 1, 0) }),
    ];
    const summaries = providers.map((provider) => ({ id: provider.manifest.id, sample: provider.sample(vec3(0, 0, 0)) }));
    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.sample.scalars.light).toBe(1);
    expect(summaries[1]?.sample.vectors.flow).toEqual(vec3(0, 1, 0));
  });
});
