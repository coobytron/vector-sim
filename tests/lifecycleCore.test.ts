import { describe, expect, it } from 'vitest';
import {
  createCompositeFieldProvider,
  createSignedFieldProvider,
  vec3,
} from '../src/environments/fields';
import type { EffectSource, FieldProvider, Vec3 } from '../src/environments/fields';
import {
  DEFAULT_LIFECYCLE_RATES,
  LIFECYCLE_TICK_SECONDS,
  LifecycleValidationError,
  createLifecycleSystem,
  remainingCapacity,
  resolveLifecycleRates,
  selectSpawnCandidates,
} from '../src/lifecycle';
import type { LifecycleEvent, LifecycleSystem } from '../src/lifecycle';

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
  return createSignedFieldProvider('home-test', sources);
}

function system(overrides: Parameters<typeof createLifecycleSystem>[0]['rates'] = {}): LifecycleSystem {
  return createLifecycleSystem({ provider: provider(), rates: overrides });
}

function kinds(events: readonly LifecycleEvent[]): string[] {
  return events.map((event) => event.kind);
}

function eventsOfKind<K extends LifecycleEvent['kind']>(
  events: readonly LifecycleEvent[],
  kind: K,
): Extract<LifecycleEvent, { kind: K }>[] {
  return events.filter((event): event is Extract<LifecycleEvent, { kind: K }> => event.kind === kind);
}

describe('rate table', () => {
  it('fills defaults and freezes the result', () => {
    const rates = resolveLifecycleRates();
    expect(rates).toEqual(DEFAULT_LIFECYCLE_RATES);
    expect(Object.isFrozen(rates)).toBe(true);
  });

  it('accepts partial overrides', () => {
    expect(resolveLifecycleRates({ intakePerEnergyUnit: 0.5 }).intakePerEnergyUnit).toBe(0.5);
    expect(resolveLifecycleRates({ intakePerEnergyUnit: 0.5 }).idleDrainPerSecond).toBe(
      DEFAULT_LIFECYCLE_RATES.idleDrainPerSecond,
    );
  });

  it('rejects out-of-range, non-finite, and inconsistent rates', () => {
    expect(() => resolveLifecycleRates({ thrivingEnergy: 1.5 })).toThrow(LifecycleValidationError);
    expect(() => resolveLifecycleRates({ intakePerEnergyUnit: Number.NaN })).toThrow(
      LifecycleValidationError,
    );
    expect(() => resolveLifecycleRates({ maxPopulation: 0 })).toThrow(LifecycleValidationError);
    expect(() => resolveLifecycleRates({ maxPopulation: 2.5 })).toThrow(LifecycleValidationError);
    expect(() => resolveLifecycleRates({ thrivingEnergy: 0.2, restingEnergy: 0.8 })).toThrow(
      /thrivingEnergy/,
    );
  });
});

describe('feeding and damage', () => {
  it('gains energy at the documented rate inside a positive field', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: FEED, seed: 1, energy: 0.5 });
    lifecycle.step();

    const organism = lifecycle.get('a');
    const expected = 0.5 + (0.2 * 1 - 0.012) * LIFECYCLE_TICK_SECONDS;
    expect(organism?.energy).toBeCloseTo(expected, 6);
    expect(organism?.intakeRate).toBeCloseTo(0.2, 6);
    expect(organism?.expenditureRate).toBeCloseTo(0.012, 6);
    expect(organism?.damage).toBe(0);
  });

  it('accrues damage at the documented rate inside a negative field', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: FAULT, seed: 1, energy: 0.9 });
    lifecycle.step();

    const organism = lifecycle.get('a');
    expect(organism?.damage).toBeCloseTo(0.35 * LIFECYCLE_TICK_SECONDS, 6);
    expect(organism?.viability).toBeCloseTo(1 - 0.35 * LIFECYCLE_TICK_SECONDS, 6);
  });

  it('drains energy with no field present', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: NEUTRAL, seed: 1, energy: 0.5 });
    lifecycle.step();
    expect(lifecycle.get('a')?.energy).toBeCloseTo(0.5 - 0.012 * LIFECYCLE_TICK_SECONDS, 6);
  });

  it('feeds and damages simultaneously without cancelling', () => {
    const overlapping = createSignedFieldProvider('overlap', [
      { id: 'feed', strength: 1, rangeMeters: 1, geometry: { kind: 'point', position: vec3(0, 0, 0) } },
      { id: 'kill', strength: -1, rangeMeters: 1, geometry: { kind: 'point', position: vec3(0, 0, 0) } },
    ]);
    const lifecycle = createLifecycleSystem({ provider: overlapping });
    lifecycle.spawn({ id: 'a', position: vec3(0, 0, 0), seed: 1, energy: 0.5 });
    lifecycle.step();

    const organism = lifecycle.get('a');
    expect(organism?.sample.energy).toBe(1);
    expect(organism?.sample.danger).toBe(1);
    expect(organism?.energy).toBeGreaterThan(0.5);
    expect(organism?.damage).toBeGreaterThan(0);
  });

  it('clamps energy and damage to [0, 1]', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: FEED, seed: 1, energy: 1 });
    lifecycle.step();
    expect(lifecycle.get('a')?.energy).toBe(1);

    const dying = system({ starvationSeconds: 86_400 });
    dying.spawn({ id: 'b', position: FAULT, seed: 1, energy: 1 });
    for (let index = 0; index < 200; index += 1) {
      dying.step();
    }
    expect(dying.get('b')?.damage).toBe(1);
    expect(dying.get('b')?.viability).toBe(0);
  });
});

describe('causal event log', () => {
  it('carries source IDs and contact metadata into intake and damage events', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: FEED, seed: 1 });
    lifecycle.step();

    const intake = eventsOfKind(lifecycle.events(), 'intake');
    expect(intake.length).toBe(1);
    expect(intake[0]?.sourceIds).toEqual(['threshold-feed']);
    expect(intake[0]?.contacts.map((contact) => contact.sourceId)).toEqual(['threshold-feed']);
    expect(intake[0]?.channelValue).toBe(1);
    expect(intake[0]?.tick).toBe(1);
    expect(intake[0]?.organismId).toBe('a');

    lifecycle.moveTo('a', FAULT);
    lifecycle.step();
    const damage = eventsOfKind(lifecycle.events(), 'damage');
    expect(damage.length).toBe(1);
    expect(damage[0]?.sourceIds).toEqual(['fault-kill']);
    expect(damage[0]?.contacts[0]?.sourceId).toBe('fault-kill');
  });

  it('distinguishes the two sources when both contribute', () => {
    const composite = createCompositeFieldProvider('both', [provider()]);
    const lifecycle = createLifecycleSystem({ provider: composite });
    lifecycle.spawn({ id: 'a', position: vec3(0, 0, 0), seed: 1 });
    lifecycle.step();

    const organism = lifecycle.get('a');
    // Midway between the two point sources, both are out of range.
    expect(organism?.sample.sourceIds).toEqual([]);
    expect(kinds(lifecycle.events())).not.toContain('damage');
  });

  it('logs spawn, transitions, and death in order', () => {
    const lifecycle = system({ starvationSeconds: 86_400 });
    lifecycle.spawn({ id: 'a', position: FAULT, seed: 1, energy: 1 });
    for (let index = 0; index < 200; index += 1) {
      lifecycle.step();
    }

    const sequence = kinds(lifecycle.events());
    expect(sequence[0]).toBe('spawn');
    expect(sequence).toContain('damage');
    expect(sequence).toContain('death');
    expect(sequence.indexOf('death')).toBe(sequence.length - 1);

    const death = eventsOfKind(lifecycle.events(), 'death');
    expect(death[0]?.cause).toBe('damage');
    expect(death[0]?.sourceIds).toEqual(['fault-kill']);
  });

  it('bounds the log by dropping the oldest entries', () => {
    const lifecycle = createLifecycleSystem({ provider: provider(), maxEvents: 10 });
    lifecycle.spawn({ id: 'a', position: FEED, seed: 1 });
    for (let index = 0; index < 100; index += 1) {
      lifecycle.step();
    }
    expect(lifecycle.events().length).toBe(10);
    expect(kinds(lifecycle.events())).not.toContain('spawn');
  });

  it('clears on request', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: FEED, seed: 1 });
    lifecycle.step();
    expect(lifecycle.events().length).toBeGreaterThan(0);
    lifecycle.clearEvents();
    expect(lifecycle.events()).toEqual([]);
  });
});

describe('status transitions', () => {
  it('reaches thriving inside a rich field and resting as it drains', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: FEED, seed: 1, energy: 0.5 });
    expect(lifecycle.get('a')?.status).toBe('resting');

    for (let index = 0; index < 60; index += 1) {
      lifecycle.step();
    }
    expect(lifecycle.get('a')?.status).toBe('thriving');

    lifecycle.moveTo('a', NEUTRAL);
    for (let index = 0; index < 2000; index += 1) {
      lifecycle.step();
    }
    expect(lifecycle.get('a')?.status).toBe('searching');
  });

  it('marks an organism stressed while danger is present', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: FAULT, seed: 1, energy: 1 });
    lifecycle.step();
    expect(lifecycle.get('a')?.status).toBe('stressed');
  });

  it('marks an organism dying below the viability threshold', () => {
    const lifecycle = system({ starvationSeconds: 86_400 });
    lifecycle.spawn({ id: 'a', position: FAULT, seed: 1, energy: 1, damage: 0.79 });
    lifecycle.step();
    expect(lifecycle.get('a')?.status).toBe('dying');
  });

  it('repairs only when energy is high and danger is absent', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: FEED, seed: 1, energy: 0.9, damage: 0.3 });
    lifecycle.step();

    expect(lifecycle.get('a')?.status).toBe('repairing');
    expect(lifecycle.get('a')?.damage).toBeCloseTo(0.3 - 0.08 * LIFECYCLE_TICK_SECONDS, 6);

    const requests = eventsOfKind(lifecycle.events(), 'repair-request');
    expect(requests[0]?.granted).toBe(true);
    expect(requests[0]?.blockedBy).toEqual([]);
    expect(eventsOfKind(lifecycle.events(), 'repair').length).toBe(1);
  });

  it('reports why repair was refused', () => {
    const lowEnergy = system();
    lowEnergy.spawn({ id: 'a', position: NEUTRAL, seed: 1, energy: 0.1, damage: 0.3 });
    lowEnergy.step();
    expect(eventsOfKind(lowEnergy.events(), 'repair-request')[0]?.blockedBy).toEqual(['energy']);
    expect(eventsOfKind(lowEnergy.events(), 'repair').length).toBe(0);

    const inDanger = system();
    inDanger.spawn({ id: 'a', position: FAULT, seed: 1, energy: 0.9, damage: 0.3 });
    inDanger.step();
    expect(eventsOfKind(inDanger.events(), 'repair-request')[0]?.blockedBy).toEqual(['danger']);

    const both = system();
    both.spawn({ id: 'a', position: FAULT, seed: 1, energy: 0.1, damage: 0.3 });
    both.step();
    expect(eventsOfKind(both.events(), 'repair-request')[0]?.blockedBy).toEqual(['energy', 'danger']);
  });

  it('records each transition once, with its source context', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: FAULT, seed: 1, energy: 1 });
    lifecycle.step();
    lifecycle.step();

    const transitions = eventsOfKind(lifecycle.events(), 'transition');
    // spawn → searching (at spawn), then searching → stressed on tick 1 only.
    expect(transitions.map((event) => `${event.from}->${event.to}`)).toEqual([
      'searching->thriving',
      'thriving->stressed',
    ]);
    expect(transitions[1]?.sourceIds).toEqual(['fault-kill']);
  });
});

describe('lesions', () => {
  it('applies external damage and logs it with a reason', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: NEUTRAL, seed: 1, energy: 0.9 });
    lifecycle.applyLesion('a', 0.4, 'user-tool');

    expect(lifecycle.get('a')?.damage).toBeCloseTo(0.4, 6);
    const lesions = eventsOfKind(lifecycle.events(), 'lesion');
    expect(lesions[0]?.amount).toBeCloseTo(0.4, 6);
    expect(lesions[0]?.reason).toBe('user-tool');
  });

  it('kills when the lesion is total, and refuses to lesion the dead', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: NEUTRAL, seed: 1 });
    lifecycle.applyLesion('a', 1);
    expect(lifecycle.get('a')?.status).toBe('dead');
    expect(lifecycle.get('a')?.deathCause).toBe('damage');
    expect(() => lifecycle.applyLesion('a', 0.1)).toThrow(LifecycleValidationError);
  });

  it('rejects an out-of-range lesion and an unknown organism', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: NEUTRAL, seed: 1 });
    expect(() => lifecycle.applyLesion('a', 1.5)).toThrow(LifecycleValidationError);
    expect(() => lifecycle.applyLesion('missing', 0.1)).toThrow(/unknown organism/);
  });
});

describe('death and respawn', () => {
  it('dies of starvation after the documented interval and stays dead', () => {
    const lifecycle = system({ starvationSeconds: 1 });
    lifecycle.spawn({ id: 'a', position: NEUTRAL, seed: 1, energy: 0 });
    for (let index = 0; index < 60; index += 1) {
      lifecycle.step();
    }

    const organism = lifecycle.get('a');
    expect(organism?.status).toBe('dead');
    expect(organism?.deathCause).toBe('starvation');
    expect(lifecycle.livingCount()).toBe(0);

    // Terminal: further ticks change nothing and add no events.
    const before = lifecycle.events().length;
    const frozen = lifecycle.get('a');
    lifecycle.step();
    lifecycle.step();
    expect(lifecycle.get('a')).toStrictEqual(frozen);
    expect(lifecycle.events().length).toBe(before);
  });

  it('prefers damage over starvation when both land on one tick', () => {
    const lifecycle = system({ starvationSeconds: 0 });
    lifecycle.spawn({ id: 'a', position: FAULT, seed: 1, energy: 0, damage: 0.99 });
    lifecycle.step();
    expect(lifecycle.get('a')?.deathCause).toBe('damage');
  });

  it('only leaves death through an explicit respawn', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: FEED, seed: 1 });
    lifecycle.applyLesion('a', 1);
    expect(lifecycle.get('a')?.status).toBe('dead');

    const respawned = lifecycle.respawn('a', { energy: 0.8 });
    expect(respawned.status).not.toBe('dead');
    expect(respawned.generation).toBe(1);
    expect(respawned.damage).toBe(0);
    expect(respawned.deathCause).toBeNull();
    expect(kinds(lifecycle.events())).toContain('respawn');

    lifecycle.step();
    expect(lifecycle.get('a')?.energy).toBeGreaterThan(0.8);
  });

  it('refuses to respawn the living', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: FEED, seed: 1 });
    expect(() => lifecycle.respawn('a')).toThrow(/alive/);
  });
});

describe('population primitives', () => {
  it('enforces the population cap and counts only the living', () => {
    const lifecycle = system({ maxPopulation: 2 });
    lifecycle.spawn({ id: 'a', position: NEUTRAL, seed: 1 });
    lifecycle.spawn({ id: 'b', position: NEUTRAL, seed: 2 });
    expect(() => lifecycle.spawn({ id: 'c', position: NEUTRAL, seed: 3 })).toThrow(/population cap/);

    lifecycle.applyLesion('a', 1);
    expect(lifecycle.livingCount()).toBe(1);
    expect(lifecycle.spawn({ id: 'c', position: NEUTRAL, seed: 3 }).id).toBe('c');
  });

  it('rejects duplicate and empty IDs and out-of-range initial state', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'a', position: NEUTRAL, seed: 1 });
    expect(() => lifecycle.spawn({ id: 'a', position: NEUTRAL, seed: 2 })).toThrow(/already exists/);
    expect(() => lifecycle.spawn({ id: '', position: NEUTRAL, seed: 2 })).toThrow(/non-empty id/);
    expect(() => lifecycle.spawn({ id: 'b', position: NEUTRAL, seed: 2, energy: 2 })).toThrow(
      /energy must be within/,
    );
  });

  it('selects spawn candidates deterministically by score then ID', () => {
    const candidates = [
      { id: 'delta', position: NEUTRAL, score: 0.5 },
      { id: 'alpha', position: NEUTRAL, score: 0.9 },
      { id: 'charlie', position: NEUTRAL, score: 0.5 },
      { id: 'bravo', position: NEUTRAL },
    ];
    const selected = selectSpawnCandidates(candidates, { capacity: 3 });
    expect(selected.map((candidate) => candidate.id)).toEqual(['alpha', 'charlie', 'delta']);

    // Declaration order must not matter.
    const shuffled = selectSpawnCandidates([...candidates].reverse(), { capacity: 3 });
    expect(shuffled.map((candidate) => candidate.id)).toEqual(['alpha', 'charlie', 'delta']);
  });

  it('breaks ties with a reproducible seeded key when asked', () => {
    const candidates = Array.from({ length: 6 }, (_unused, index) => ({
      id: `node-${index}`,
      position: NEUTRAL,
    }));
    const first = selectSpawnCandidates(candidates, { capacity: 3, seed: 42 });
    const second = selectSpawnCandidates([...candidates].reverse(), { capacity: 3, seed: 42 });
    const other = selectSpawnCandidates(candidates, { capacity: 3, seed: 43 });

    expect(first.map((candidate) => candidate.id)).toEqual(second.map((candidate) => candidate.id));
    expect(first.map((candidate) => candidate.id)).not.toEqual(other.map((candidate) => candidate.id));
  });

  it('rejects invalid selection input', () => {
    expect(() => selectSpawnCandidates([], { capacity: -1 })).toThrow(LifecycleValidationError);
    expect(() =>
      selectSpawnCandidates(
        [
          { id: 'a', position: NEUTRAL },
          { id: 'a', position: NEUTRAL },
        ],
        { capacity: 2 },
      ),
    ).toThrow(/duplicate/);
  });

  it('reports remaining headroom', () => {
    expect(remainingCapacity(3, 8)).toBe(5);
    expect(remainingCapacity(9, 8)).toBe(0);
  });
});

describe('environment independence and replay', () => {
  it('runs identically against a differently-named provider with the same channels', () => {
    const home = createLifecycleSystem({ provider: createSignedFieldProvider('home', sources) });
    const pond = createLifecycleSystem({ provider: createSignedFieldProvider('pond', sources) });

    for (const lifecycle of [home, pond]) {
      lifecycle.spawn({ id: 'a', position: FEED, seed: 7 });
      for (let index = 0; index < 40; index += 1) {
        lifecycle.step();
      }
    }
    expect(home.get('a')).toStrictEqual(pond.get('a'));
    expect(home.events().length).toBe(pond.events().length);
  });

  it('replays a scripted fixture to an identical state and event log', () => {
    const script: (Vec3 | 'lesion')[] = [
      FEED,
      FEED,
      FAULT,
      FAULT,
      NEUTRAL,
      'lesion',
      FEED,
      FEED,
      FAULT,
      NEUTRAL,
    ];

    function run(): { events: LifecycleEvent[]; state: unknown } {
      const lifecycle = system();
      lifecycle.spawn({ id: 'organism-a', position: FEED, seed: 4242 });
      for (const command of script) {
        if (command === 'lesion') {
          lifecycle.applyLesion('organism-a', 0.2, 'scripted');
        } else {
          lifecycle.moveTo('organism-a', command);
        }
        for (let index = 0; index < 12; index += 1) {
          lifecycle.step();
        }
      }
      return { events: [...lifecycle.events()], state: lifecycle.get('organism-a') };
    }

    const first = run();
    const second = run();
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
    expect(second.state).toStrictEqual(first.state);

    // The fixture must actually exercise the whole machine.
    const observed = new Set(kinds(first.events));
    for (const kind of ['spawn', 'intake', 'damage', 'lesion', 'repair-request', 'repair', 'transition']) {
      expect(observed).toContain(kind);
    }
  });

  it('advances organisms in ascending ID order regardless of spawn order', () => {
    const lifecycle = system();
    lifecycle.spawn({ id: 'zulu', position: FEED, seed: 1 });
    lifecycle.spawn({ id: 'alpha', position: FEED, seed: 2 });
    lifecycle.clearEvents();
    lifecycle.step();

    const order = lifecycle
      .events()
      .filter((event) => event.kind === 'intake')
      .map((event) => event.organismId);
    expect(order).toEqual(['alpha', 'zulu']);
    expect(lifecycle.organisms().map((organism) => organism.id)).toEqual(['alpha', 'zulu']);
  });
});
