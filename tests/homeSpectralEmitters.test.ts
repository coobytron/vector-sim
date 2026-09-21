import type { LineSegments } from 'three';
import { describe, expect, it } from 'vitest';
import { createSignedFieldProvider, vec3 } from '../src/environments/fields';
import { HomeSpectralEmitters } from '../src/rendering/homeSpectralEmitters';
import { HeadlessSimulation } from '../src/simulation/headlessSimulation';
import { QUALITY_TIERS } from '../src/simulation/types';
import { SPECTRAL_LOOKS } from '../src/spectral/looks';

function fixture(strength: number) {
  return new HeadlessSimulation({
    tier: { ...QUALITY_TIERS.mobile, organisms: 1, slotsPerOrganism: 32 }, seed: 42,
    fieldProvider: createSignedFieldProvider('fixture', [{
      id: 'contact', strength, rangeMeters: 1,
      geometry: { kind: 'sphere', center: vec3(0, 0, 0), radiusMeters: 10 },
    }]),
  });
}

describe('Home causal source cues', () => {
  it('stays unlit without lifecycle contact, including paused startup', () => {
    const emitter = new HomeSpectralEmitters(SPECTRAL_LOOKS.porcelain, 1);
    const simulation = fixture(0);
    emitter.update(simulation.snapshot.lifecycle);
    expect(emitter.group.visible).toBe(false);
    simulation.step();
    emitter.update(simulation.snapshot.lifecycle);
    expect(emitter.group.visible).toBe(false);
    emitter.update(undefined);
    expect(emitter.group.visible).toBe(false);
  });

  it.each([1, -1])('anchors strength %s at the actual contact and reuses geometry', (strength) => {
    const emitter = new HomeSpectralEmitters(SPECTRAL_LOOKS.porcelain, 1);
    const simulation = fixture(strength);
    simulation.step();
    emitter.update(simulation.snapshot.lifecycle);
    expect(emitter.group.visible).toBe(true);
    const line = emitter.group.children[0] as LineSegments;
    const positions = line.geometry.getAttribute('position');
    const colors = line.geometry.getAttribute('color');
    const offset = strength > 0 ? 0 : 2;
    const view = simulation.snapshot.lifecycle!.presentations.get(0)!;
    const focus = strength > 0 ? view.feedFocus! : view.damageFocus!;
    expect([positions.getX(offset), positions.getY(offset), positions.getZ(offset)])
      .toEqual([focus.point!.x, focus.point!.y, focus.point!.z]);
    const center = simulation.snapshot.lifecycle!.states[0]!.position;
    expect([positions.getX(offset + 1), positions.getY(offset + 1), positions.getZ(offset + 1)])
      .toEqual([center.x, center.y, center.z]);
    expect(Array.from(colors.array).some((value) => value > 0)).toBe(true);
    for (let tick = 0; tick < 4; tick += 1) {
      simulation.step();
      emitter.update(simulation.snapshot.lifecycle);
    }
    expect(emitter.group.children).toEqual([line]);
    expect(line.geometry.getAttribute('position')).toBe(positions);
    expect(line.geometry.getAttribute('color')).toBe(colors);
    emitter.update(undefined);
    expect(emitter.group.visible).toBe(false);
    expect(Array.from(colors.array).every((value) => value === 0)).toBe(true);
  });
});
