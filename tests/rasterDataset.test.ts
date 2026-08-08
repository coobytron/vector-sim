import { describe, expect, it } from 'vitest';
import fixture from './fixtures/synthetic-raster.json';
import {
  FieldProviderValidationError,
  createRadialScalarProvider,
  createRasterDatasetProvider,
  vec3,
} from '../src/environments/fields';
import type { RasterDatasetManifest } from '../src/environments/fields';

const dataset = fixture as RasterDatasetManifest;

describe('raster dataset provider', () => {
  it('samples scalar and vector channels at exact grid points', () => {
    const provider = createRasterDatasetProvider(dataset);
    const sample = provider.sample(vec3(1, 0, 1));
    expect(sample.scalars.elevation).toBe(2);
    expect(sample.vectors.flow).toEqual(vec3(0.5, 0, 0.5));
  });

  it('uses deterministic bilinear interpolation', () => {
    const provider = createRasterDatasetProvider(dataset);
    const sample = provider.sample(vec3(0.5, 0, 0.5));
    expect(sample.scalars.elevation).toBe(1);
    expect(sample.vectors.flow).toEqual(vec3(0.625, 0, 0.375));
  });

  it('clamps outside samples when configured', () => {
    const provider = createRasterDatasetProvider(dataset);
    expect(provider.sample(vec3(-10, 0, -10)).scalars.elevation).toBe(0);
    expect(provider.sample(vec3(10, 0, 10)).scalars.elevation).toBe(4);
  });

  it('supports zero outside behavior', () => {
    const provider = createRasterDatasetProvider({ ...dataset, outside: 'zero' });
    const sample = provider.sample(vec3(-1, 0, 0));
    expect(sample.scalars).toEqual({});
    expect(sample.vectors).toEqual({});
  });

  it('returns byte-stable batch output', () => {
    const provider = createRasterDatasetProvider(dataset);
    const points = [vec3(0.25, 0, 0.75), vec3(1.5, 0, 1.5), vec3(2, 0, 0)];
    expect(JSON.stringify(provider.sampleBatch(points))).toBe(JSON.stringify(provider.sampleBatch(points)));
  });

  it('can replace a procedural provider under the same consumer interface', () => {
    const providers = [
      createRadialScalarProvider({ id: 'procedural', channelId: 'elevation', center: vec3(0, 0, 0), radiusMeters: 3 }),
      createRasterDatasetProvider(dataset),
    ];
    const values = providers.map((provider) => provider.sample(vec3(1, 0, 1)).scalars.elevation);
    expect(values).toHaveLength(2);
    expect(values.every((value) => typeof value === 'number')).toBe(true);
  });

  it('rejects malformed dimensions with dataset context', () => {
    expect(() => createRasterDatasetProvider({ ...dataset, width: 4 })).toThrow(FieldProviderValidationError);
    expect(() => createRasterDatasetProvider({ ...dataset, width: 4 })).toThrow(/synthetic-habitat-v1.*expected 12/);
  });
});
