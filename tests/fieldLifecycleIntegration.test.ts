import { describe, expect, it } from 'vitest';
import { createCompositeFieldProvider, createSignedFieldProvider, vec3, type FieldProvider } from '../src/environments/fields';
import { HOME_PRESETS, createHomePresetFieldProvider, withHomeEffectStrength } from '../src/environments/homePresets';
import { createLifecycleSystem } from '../src/lifecycle';
import { deriveOrganismPresentation, presentationSignature } from '../src/organisms/presentation';
import { ORGANISM_STATE_CODE } from '../src/organisms/types';
import { VectorBufferPacker } from '../src/rendering/vectorBufferPacker';
import { HeadlessSimulation } from '../src/simulation/headlessSimulation';
import { QUALITY_TIERS } from '../src/simulation/types';

const tier = { ...QUALITY_TIERS.mobile, organisms: 3, slotsPerOrganism: 32 };

function uniformEffect(strength: number, id = 'same-source'): FieldProvider {
  return createSignedFieldProvider('fixture', [{
    id, strength, rangeMeters: 1,
    geometry: { kind: 'sphere', center: vec3(0, 0, 0), radiusMeters: 10 },
  }]);
}

function simulation(provider: FieldProvider) {
  return new HeadlessSimulation({ tier, seed: 401, fieldProvider: provider });
}

describe('field → lifecycle → presentation integration', () => {
  it('uses the shared lifecycle rates exactly once and passes that state to the cell decoder', () => {
    const sim = simulation(uniformEffect(1));
    const oracle = createLifecycleSystem({ provider: uniformEffect(1) });
    oracle.spawn({ id: 'oracle', seed: 401, position: vec3(0, 0, 0) });
    for (let tick = 0; tick < 20; tick += 1) { sim.step(); oracle.step(); }
    expect(sim.energy[0]).toBe(oracle.get('oracle')!.energy);
    expect(sim.health[0]).toBe(oracle.get('oracle')!.viability);
    const snapshot = sim.snapshot;
    const presentation = snapshot.lifecycle!.presentations.get(0)!;
    expect(presentation.visualState).toBe('feeding');
    const packed = new VectorBufferPacker(snapshot).update(snapshot, 1, { presentations: snapshot.lifecycle!.presentations });
    expect(packed.nodeStates[0]).toBe(ORGANISM_STATE_CODE.feeding);
    expect(packed.organismTrailPersistence[0]).toBeCloseTo(presentation.trailPersistence);
    expect(snapshot.lifecycle!.events.every((event) => event.tick === sim.tick)).toBe(true);
  });

  it('changes behavior by changing only a Home manifest source sign', () => {
    const base = HOME_PRESETS['tabletop-habitat'];
    const fixture = { ...base, effectSources: [{
      id: base.switchableEffectSourceId, strength: 1, rangeMeters: 1,
      geometry: { kind: 'sphere' as const, center: vec3(0, 0, 0), radiusMeters: 10 },
    }] };
    const fed = simulation(createHomePresetFieldProvider(fixture));
    const damaged = simulation(createHomePresetFieldProvider(withHomeEffectStrength(fixture, base.switchableEffectSourceId, -1)));
    for (let tick = 0; tick < 30; tick += 1) { fed.step(); damaged.step(); }
    expect(fed.energy[0]).toBeGreaterThan(damaged.energy[0]!);
    expect(fed.health[0]).toBe(1);
    expect(damaged.health[0]).toBeLessThan(1);
    expect(fed.snapshot.lifecycle!.presentations.get(0)!.feedFocus!.sourceIds).toEqual([base.switchableEffectSourceId]);
    expect(damaged.snapshot.lifecycle!.presentations.get(0)!.damageFocus!.sourceIds).toEqual([base.switchableEffectSourceId]);
    expect(fixture.effectSources[0]!.strength).toBe(1);
  });

  it('keeps overlapping food and danger contacts separate through composition and presentation', () => {
    const signed = createSignedFieldProvider('overlap', [
      { id: 'food', strength: 0.6, rangeMeters: 2, geometry: { kind: 'point', position: vec3(-0.2, 0, 0) } },
      { id: 'hazard', strength: -1, rangeMeters: 2, geometry: { kind: 'point', position: vec3(0.1, 0, 0) } },
    ]);
    const provider = createCompositeFieldProvider('composed', [signed]);
    const core = createLifecycleSystem({ provider });
    core.spawn({ id: 'one', seed: 1, position: vec3(0, 0, 0) });
    core.step();
    const view = deriveOrganismPresentation(core.get('one')!, core.events(), core.tick);
    expect(view.feedFocus!.sourceIds).toEqual(['food']);
    expect(view.feedFocus!.point).toEqual(vec3(-0.2, 0, 0));
    expect(view.damageFocus!.sourceIds).toEqual(['hazard']);
    expect(view.damageFocus!.point).toEqual(vec3(0.1, 0, 0));
    const sampled = provider.sample(vec3(0, 0, 0));
    expect(Object.isFrozen(sampled.channelContexts!.energy!.contacts)).toBe(true);
  });

  it('freezes dead organisms and lets the existing presentation fade expire without resurrection', () => {
    const sim = simulation(uniformEffect(-1));
    for (let tick = 0; tick < 100; tick += 1) sim.step();
    expect(sim.snapshot.lifecycle!.states.every((state) => state.status === 'dead')).toBe(true);
    const positions = sim.snapshot.positions.slice();
    const latent = sim.snapshot.latent.slice();
    for (let tick = 0; tick < 60; tick += 1) sim.step();
    expect(sim.snapshot.positions).toEqual(positions);
    expect(sim.snapshot.latent).toEqual(latent);
    const snapshot = sim.snapshot;
    expect(snapshot.lifecycle!.presentations.get(0)!.opacity).toBe(0);
    const packed = new VectorBufferPacker(snapshot).update(snapshot, 1, { presentations: snapshot.lifecycle!.presentations });
    expect(packed.nodeOpacities.every((opacity) => opacity === 0)).toBe(true);
    expect(packed.organismTrailPersistence.every((persistence) => persistence === 0)).toBe(true);
  });

  it.each(Object.values(HOME_PRESETS))('replays $id deterministically through current-tick lifecycle events', (preset) => {
    const first = simulation(createHomePresetFieldProvider(preset));
    const second = simulation(createHomePresetFieldProvider(preset));
    for (let tick = 0; tick < 30; tick += 1) { first.step(); second.step(); }
    expect(first.stateHash()).toBe(second.stateHash());
    expect(first.snapshot.lifecycle!.events).toEqual(second.snapshot.lifecycle!.events);
    expect([...first.snapshot.lifecycle!.presentations.values()].map(presentationSignature))
      .toEqual([...second.snapshot.lifecycle!.presentations.values()].map(presentationSignature));
  });

  it('includes causal source identity in its hash and rejects a mismatched lifecycle cadence', () => {
    const first = simulation(uniformEffect(1, 'a'));
    const second = simulation(uniformEffect(1, 'b'));
    first.step(); second.step();
    expect(first.snapshot.positions).toEqual(second.snapshot.positions);
    expect(first.stateHash()).not.toBe(second.stateHash());
    const before = first.stateHash();
    expect(() => first.step(1 / 60)).toThrow('fixed 1/30-second');
    expect(first.stateHash()).toBe(before);
  });
});
