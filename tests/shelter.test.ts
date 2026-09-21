import { describe, expect, it } from 'vitest';
import {
  createCompositeFieldProvider, createShelterFieldProvider, createSignedFieldProvider,
  FieldProviderValidationError, vec3,
} from '../src/environments/fields';
import { HOME_PRESETS, createHomePresetFieldProvider } from '../src/environments/homePresets';
import { createLifecycleSystem } from '../src/lifecycle';

const origin = vec3(0, 0, 0);
const region = { id: 'cover', center: origin, halfExtentsMeters: vec3(1, 1, 1), strength: 1 };

describe('shelter field and metabolism', () => {
  it('includes box faces and corners, excludes outside points, and supplies no light contact', () => {
    const provider = createShelterFieldProvider('shelter', [region]);
    expect(provider.sampleBatch([origin, vec3(1, 1, 1), vec3(1.001, 0, 0)])
      .map((sample) => sample.scalars.shelter)).toEqual([1, 1, 0]);
    expect(provider.sample(origin).contacts).toEqual([]);
    expect(provider.sample(vec3(2, 0, 0)).sourceIds).toEqual([]);
  });

  it('combines overlapping regions by saturating union in stable source order', () => {
    const regions = [{ ...region, id: 'b', strength: 0.5 }, { ...region, id: 'a', strength: 0.5 }];
    const first = createShelterFieldProvider('shelter', regions).sample(origin);
    expect(first.scalars.shelter).toBe(0.75);
    expect(first.sourceIds).toEqual(['a', 'b']);
    expect(createShelterFieldProvider('shelter', [...regions].reverse()).sample(origin)).toEqual(first);
    expect(createShelterFieldProvider('empty', []).sample(origin).scalars.shelter).toBe(0);
  });

  it('copies authored inputs and rejects malformed volumes', () => {
    const mutable = { ...region, center: { x: 0, y: 0, z: 0 } };
    const provider = createShelterFieldProvider('shelter', [mutable]);
    mutable.center.x = 20;
    mutable.strength = 0;
    expect(provider.sample(origin).scalars.shelter).toBe(1);
    for (const strength of [-1, 1.1, NaN, Infinity]) {
      expect(() => createShelterFieldProvider('bad', [{ ...region, strength }])).toThrow(FieldProviderValidationError);
    }
    expect(() => createShelterFieldProvider('bad', [region, region])).toThrow(/duplicate/);
    expect(() => createShelterFieldProvider('bad', [{ ...region, halfExtentsMeters: vec3(-1, 1, 1) }])).toThrow(/extents/);
    expect(() => createShelterFieldProvider('bad', [{ ...region, center: vec3(Infinity, 0, 0) }])).toThrow(/finite/);
  });

  it('reduces idle drain by up to 40%, and leaving shelter restores baseline expenditure', () => {
    for (const strength of [0, 0.5, 1]) {
      const system = createLifecycleSystem({ provider: createShelterFieldProvider('shelter', [{ ...region, strength }]) });
      system.spawn({ id: 'organism', position: origin, seed: 1, energy: 0.3, damage: 0.2 });
      for (let tick = 0; tick < 30; tick++) system.step();
      const state = system.get('organism')!;
      expect(state.sample.shelter).toBe(strength);
      expect(state.expenditureRate).toBeCloseTo(0.012 * (1 - 0.4 * strength), 8);
      expect(state.energy).toBeCloseTo(0.3 - 0.012 * (1 - 0.4 * strength), 6);
      expect(state.damage).toBeCloseTo(0.2, 7);
      expect(system.events().some((event) => event.kind === 'intake' || event.kind === 'repair')).toBe(false);
      system.moveTo('organism', vec3(2, 0, 0));
      system.step();
      expect(system.get('organism')!.expenditureRate).toBeCloseTo(0.012, 8);
    }
  });

  it('does not cancel hazard damage or attribute feeding to shelter', () => {
    const effects = createSignedFieldProvider('effects', [
      { id: 'food', strength: 1, rangeMeters: 1, geometry: { kind: 'point', position: origin } },
      { id: 'hazard', strength: -1, rangeMeters: 1, geometry: { kind: 'point', position: origin } },
    ]);
    const systems = [effects, createCompositeFieldProvider('covered', [effects, createShelterFieldProvider('shelter', [region])])]
      .map((provider) => createLifecycleSystem({ provider }));
    for (const system of systems) {
      system.spawn({ id: 'organism', position: origin, seed: 1 });
      system.step();
      expect(system.events().find((event) => event.kind === 'intake')!.sourceIds).toEqual(['food']);
      expect(system.events().find((event) => event.kind === 'damage')!.sourceIds).toEqual(['hazard']);
    }
    expect(systems[0]!.get('organism')!.damage).toBe(systems[1]!.get('organism')!.damage);
    expect(systems[1]!.get('organism')!.energy).toBeGreaterThan(systems[0]!.get('organism')!.energy);
  });

  it.each(Object.values(HOME_PRESETS))('connects authored shelter to lifecycle for $id', (preset) => {
    const system = createLifecycleSystem({ provider: createHomePresetFieldProvider(preset) });
    for (const shelter of preset.shelterRegions) {
      system.spawn({ id: shelter.id, position: shelter.center, seed: preset.seed });
    }
    system.step();
    for (const shelter of preset.shelterRegions) {
      const state = system.get(shelter.id)!;
      expect(state.sample.shelter).toBeCloseTo(shelter.strength, 7);
      expect(state.expenditureRate).toBeCloseTo(0.012 * (1 - 0.4 * shelter.strength), 8);
    }
  });
});
