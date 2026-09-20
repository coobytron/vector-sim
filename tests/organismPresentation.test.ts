import { describe, expect, it } from 'vitest';
import { createSignedFieldProvider, vec3 } from '../src/environments/fields';
import type { EffectSource, FieldProvider } from '../src/environments/fields';
import { createLifecycleSystem } from '../src/lifecycle';
import type { LifecycleSystem } from '../src/lifecycle';
import {
  applyPresentationToDecodeInput,
  deriveOrganismPresentation,
  presentationSignature,
  type OrganismPresentationState,
} from '../src/organisms/presentation';
import { NODE_ROLE, type VisualDecodeInput } from '../src/organisms/types';
import { createDecodedCellVisual, decodeCellVisual } from '../src/organisms/visualState';
import { DEATH_WAVELENGTH_NM } from '../src/spectral/color';

const FEED = vec3(1, 0, 0);
const FAULT = vec3(-1, 0, 0);
const NEUTRAL = vec3(0, 5, 0);

const sources: EffectSource[] = [
  {
    id: 'threshold-feed',
    strength: 1,
    rangeMeters: 0.5,
    geometry: { kind: 'point', position: FEED },
  },
  {
    id: 'fault-kill',
    strength: -1,
    rangeMeters: 0.5,
    geometry: { kind: 'point', position: FAULT },
  },
];

function provider(): FieldProvider {
  return createSignedFieldProvider('presentation-test', sources);
}

interface Frame {
  readonly tick: number;
  readonly presentation: OrganismPresentationState;
  readonly signature: string;
}

/**
 * Scripted deterministic fixture: rest -> feed -> damage -> dying -> death.
 *
 * The organism is teleported between authored sources rather than driven by a
 * behaviour model, so the sequence is fully reproducible and every transition is
 * caused by a field the test can name.
 */
function runFixture(): { system: LifecycleSystem; frames: Frame[] } {
  const system = createLifecycleSystem({ provider: provider() });
  system.spawn({ id: 'organism-a', position: NEUTRAL, seed: 7, energy: 0.5 });
  const frames: Frame[] = [];

  // At `damagePerDangerUnit` 0.35/s and 30 Hz, a full-contribution fault needs
  // ~69 ticks to cross the dying threshold and ~86 to reach death.
  const script: Array<{ readonly ticks: number; readonly position: typeof NEUTRAL }> = [
    { ticks: 6, position: NEUTRAL },
    { ticks: 24, position: FEED },
    { ticks: 110, position: FAULT },
    { ticks: 20, position: NEUTRAL },
  ];

  for (const stage of script) {
    system.moveTo('organism-a', stage.position);
    for (let step = 0; step < stage.ticks; step += 1) {
      const tick = system.step();
      const organism = system.get('organism-a');
      if (!organism) throw new Error('fixture organism disappeared');
      const presentation = deriveOrganismPresentation(organism, system.events(), tick);
      frames.push({ tick, presentation, signature: presentationSignature(presentation) });
    }
  }

  return { system, frames };
}

function firstFrameWhere(
  frames: readonly Frame[],
  predicate: (frame: Frame) => boolean,
): Frame | undefined {
  return frames.find(predicate);
}

function decodeFor(presentation: OrganismPresentationState) {
  const input: VisualDecodeInput = {
    energy: 0,
    health: 1,
    previousHealth: 1,
    activity: 0.5,
    thicknessSignal: 0,
    curvatureSignal: 0,
    connectivitySignal: 0,
    role: NODE_ROLE.structure,
    phase: 0,
  };
  applyPresentationToDecodeInput(presentation, input);
  return decodeCellVisual(input, createDecodedCellVisual());
}

describe('lifecycle to presentation mapping', () => {
  it('produces a distinct presentation for feeding, damage, dying, and death', () => {
    const { frames } = runFixture();
    const states = new Set(frames.map((frame) => frame.presentation.visualState));

    expect(states.has('feeding')).toBe(true);
    expect(states.has('damaged')).toBe(true);
    expect(states.has('dying')).toBe(true);
    expect(states.has('death')).toBe(true);

    const feeding = firstFrameWhere(frames, (f) => f.presentation.visualState === 'feeding');
    const damaged = firstFrameWhere(frames, (f) => f.presentation.visualState === 'damaged');
    const dying = firstFrameWhere(frames, (f) => f.presentation.visualState === 'dying');
    const death = firstFrameWhere(frames, (f) => f.presentation.visualState === 'death');

    // Distinct as presentation, not just as a label.
    const signatures = [feeding, damaged, dying, death].map((frame) => frame?.signature);
    expect(new Set(signatures).size).toBe(4);

    // Form collapses monotonically along the damage axis.
    expect(dying?.presentation.continuity).toBeLessThan(damaged?.presentation.continuity ?? 1);
    expect(death?.presentation.continuity).toBeLessThan(dying?.presentation.continuity ?? 1);
    expect(death?.presentation.trailPersistence).toBe(0);
  });

  it('localizes feeding and damage from causal source metadata', () => {
    const { frames } = runFixture();

    const feeding = firstFrameWhere(frames, (f) => f.presentation.feedFocus !== null);
    expect(feeding?.presentation.feedFocus?.sourceIds).toContain('threshold-feed');
    expect(feeding?.presentation.feedFocus?.point).not.toBeNull();
    expect(feeding?.presentation.feedFocus?.contribution).toBeGreaterThan(0);

    const damaged = firstFrameWhere(frames, (f) => f.presentation.damageFocus !== null);
    expect(damaged?.presentation.damageFocus?.sourceIds).toContain('fault-kill');
    expect(damaged?.presentation.damageFocus?.normal).not.toBeNull();

    // A feed contact never gets reported as the damage contact.
    for (const frame of frames) {
      const focus = frame.presentation.damageFocus;
      if (focus?.point) expect(focus.sourceIds).not.toEqual(['threshold-feed']);
    }
  });

  it('keeps the same fixture byte-stable across runs', () => {
    const first = runFixture().frames.map((frame) => frame.signature);
    const second = runFixture().frames.map((frame) => frame.signature);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(100);
  });

  it('shows a blocked repair as a restrained pending cue, not as regeneration', () => {
    const system = createLifecycleSystem({ provider: provider() });
    system.spawn({ id: 'hurt', position: NEUTRAL, seed: 3, energy: 0, damage: 0.4 });
    const tick = system.step();
    const organism = system.get('hurt');
    if (!organism) throw new Error('missing organism');
    const presentation = deriveOrganismPresentation(organism, system.events(), tick);

    expect(presentation.repairPending).toBe(true);
    expect(presentation.repairBlockedBy).toContain('energy');
    // Repair was refused, so the organism must not claim recovery.
    expect(presentation.visualState).not.toBe('regenerating');
    expect(presentation.emissionCeiling).toBeLessThan(0.5);

    const decoded = decodeFor(presentation);
    expect(decoded.emissionStrength).toBeLessThanOrEqual(presentation.emissionCeiling);
  });

  it('caps a granted repair below a full life return', () => {
    const system = createLifecycleSystem({ provider: provider() });
    system.spawn({ id: 'healing', position: NEUTRAL, seed: 4, energy: 1, damage: 0.3 });
    const tick = system.step();
    const organism = system.get('healing');
    if (!organism) throw new Error('missing organism');
    const presentation = deriveOrganismPresentation(organism, system.events(), tick);

    expect(presentation.status).toBe('repairing');
    expect(presentation.visualState).toBe('regenerating');
    expect(presentation.repairPending).toBe(false);
    // Deterministic repair is real, but learned structural regrowth is not
    // proven yet, so emission stays short of a full life return.
    expect(presentation.emissionCeiling).toBeGreaterThan(0);
    expect(presentation.emissionCeiling).toBeLessThan(1);
  });

  it('fades death once instead of re-igniting on a wrapping phase', () => {
    const { frames } = runFixture();
    const deathFrames = frames.filter((frame) => frame.presentation.visualState === 'death');
    expect(deathFrames.length).toBeGreaterThan(4);

    // Phase is anchored to the transition and clamped, so it never wraps.
    for (let index = 1; index < deathFrames.length; index += 1) {
      const previous = deathFrames[index - 1]?.presentation.eventPhase ?? 0;
      const current = deathFrames[index]?.presentation.eventPhase ?? 0;
      expect(current).toBeGreaterThanOrEqual(previous);
      expect(current).toBeLessThanOrEqual(1);
    }

    const strengths = deathFrames.map((frame) => decodeFor(frame.presentation).emissionStrength);
    for (let index = 1; index < strengths.length; index += 1) {
      expect(strengths[index] ?? 0).toBeLessThanOrEqual((strengths[index - 1] ?? 0) + 1e-6);
    }
    expect(strengths[strengths.length - 1] ?? 1).toBeLessThan(strengths[0] ?? 0);
  });

  it('holds death on the exclusive endpoint red', () => {
    const { frames } = runFixture();
    for (const frame of frames) {
      const decoded = decodeFor(frame.presentation);
      if (frame.presentation.visualState === 'death') {
        expect(decoded.wavelengthNm).toBe(DEATH_WAVELENGTH_NM);
      } else if (decoded.emissionStrength > 0) {
        expect(decoded.wavelengthNm).toBeLessThan(DEATH_WAVELENGTH_NM);
      }
    }
  });

  it('emits nothing while resting', () => {
    const system = createLifecycleSystem({ provider: provider() });
    system.spawn({ id: 'calm', position: NEUTRAL, seed: 9, energy: 0.5 });
    const tick = system.step();
    const organism = system.get('calm');
    if (!organism) throw new Error('missing organism');
    const presentation = deriveOrganismPresentation(organism, system.events(), tick);

    expect(presentation.visualState).toBe('dormant');
    expect(presentation.emissionEvent).toBeNull();
    expect(decodeFor(presentation).emissionStrength).toBe(0);
  });

  it('ignores events belonging to other organisms and other ticks', () => {
    const system = createLifecycleSystem({ provider: provider() });
    system.spawn({ id: 'a', position: FEED, seed: 1, energy: 0.5 });
    system.spawn({ id: 'b', position: NEUTRAL, seed: 2, energy: 0.5 });
    const tick = system.step();
    const b = system.get('b');
    if (!b) throw new Error('missing organism');

    const presentation = deriveOrganismPresentation(b, system.events(), tick);
    expect(presentation.feedFocus).toBeNull();

    const stale = deriveOrganismPresentation(b, system.events(), tick + 5);
    expect(stale.feedFocus).toBeNull();
    expect(stale.damageFocus).toBeNull();
  });
});
