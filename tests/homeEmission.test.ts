import { describe, expect, it } from 'vitest';
import weights from '../src/nca/models/branching-m1.weights.json';
import { loadGraphNcaModel } from '../src/nca/graph/graphNcaRuntime';
import type { GraphNcaWeightsJson } from '../src/nca/graph/graphNcaRuntime';
import { HOME_PRESETS } from '../src/environments/homePresets';
import { SPECTRAL_LOOKS } from '../src/spectral/looks';
import {
  DAMAGE_WINDOW_TICKS,
  EMISSION_HALO_METERS,
  REGROW_WINDOW_TICKS,
  computeHomeEmission,
} from '../src/homeSim/homeEmission';
import type { HomeEmission } from '../src/homeSim/homeEmission';
import { HomeWorld } from '../src/homeSim/homeWorld';
import type { HomeGoalId } from '../src/homeSim/homeWorld';

const model = loadGraphNcaModel(weights as GraphNcaWeightsJson);
const COURTYARD = HOME_PRESETS['courtyard-house'];
const LOOK = SPECTRAL_LOOKS.porcelain;

function lit(emission: HomeEmission, node: number): boolean {
  return emission.nodeColors[node * 3]! + emission.nodeColors[node * 3 + 1]! + emission.nodeColors[node * 3 + 2]! > 0;
}

function point(w: HomeWorld, node: number): [number, number, number] {
  return [w.positions[node * 3]!, w.positions[node * 3 + 1]!, w.positions[node * 3 + 2]!];
}

/** Distance from p to segment ab. */
function segmentDistance(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const ap = [p[0]! - a[0]!, p[1]! - a[1]!, p[2]! - a[2]!];
  const length2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2;
  const t = length2 > 0 ? Math.min(1, Math.max(0, (ap[0]! * ab[0]! + ap[1]! * ab[1]! + ap[2]! * ab[2]!) / length2)) : 0;
  return Math.hypot(ap[0]! - ab[0]! * t, ap[1]! - ab[1]! * t, ap[2]! - ab[2]! * t);
}

/** Runs a goal and checks every frame; returns how many ticks lit each event. */
function run(goal: HomeGoalId, ticks: number, check: (w: HomeWorld, emission: HomeEmission) => void) {
  const w = new HomeWorld(model, COURTYARD, 1, { goal });
  for (let tick = 0; tick < ticks; tick += 1) {
    w.step();
    check(w, computeHomeEmission(w, LOOK));
  }
  return w;
}

describe('M4 causal emission', { timeout: 60_000 }, () => {
  it('emits nothing without a feed, damage, lesion or regrowth event', () => {
    let idleFrames = 0;
    for (const goal of ['food', 'fault', 'shelter', 'stay'] as const) {
      run(goal, 600, (w, emission) => {
        const recent = Array.from(w.nodeLesionTick).some((t) => t >= 0 && w.tick - t < DAMAGE_WINDOW_TICKS)
          || Array.from(w.nodeRegrowTick).some((t) => t >= 0 && w.tick - t < REGROW_WINDOW_TICKS);
        if (w.fedThisTick || w.damagedThisTick || recent) return;
        idleFrames += 1;
        expect(emission.litNodes).toBe(0);
        expect(emission.lines).toHaveLength(0);
      });
    }
    expect(idleFrames).toBeGreaterThan(500);
  });

  it('lights feeding blue and damage red, each with a line from its real source', () => {
    let fed = 0;
    run('food', 600, (w, emission) => {
      const line = emission.lines.find((candidate) => candidate.event === 'feeding');
      if (!line) return;
      fed += 1;
      expect(line.sourceId).toBe(COURTYARD.switchableEffectSourceId);
      expect(line.color[2]).toBeGreaterThan(line.color[0]);
    });
    expect(fed).toBeGreaterThan(30);

    let damaged = 0;
    run('fault', 900, (w, emission) => {
      const line = emission.lines.find((candidate) => candidate.event === 'damage');
      if (!line) return;
      damaged += 1;
      expect(line.sourceId).toBe('courtyard-outlet-hazard');
      expect(line.color[0]).toBeGreaterThan(line.color[2]);
    });
    expect(damaged).toBeGreaterThan(10);
  });

  it('keeps every lit node within the event path or a 0.25 m halo', () => {
    const sites = (w: HomeWorld, emission: HomeEmission) => {
      const paths = emission.lines.map((line) => [line.from, line.to] as const);
      for (let node = 0; node < model.nodes; node += 1) {
        const flashed = (w.nodeLesionTick[node]! >= 0 && w.tick - w.nodeLesionTick[node]! < DAMAGE_WINDOW_TICKS)
          || (w.nodeRegrowTick[node]! >= 0 && w.tick - w.nodeRegrowTick[node]! < REGROW_WINDOW_TICKS);
        if (flashed) paths.push([point(w, node), point(w, node)]);
      }
      return paths;
    };
    let litFrames = 0;
    for (const goal of ['food', 'fault'] as const) {
      run(goal, 900, (w, emission) => {
        if (emission.litNodes === 0) return;
        litFrames += 1;
        const paths = sites(w, emission);
        for (let node = 0; node < model.nodes; node += 1) {
          if (!lit(emission, node)) continue;
          const nearest = Math.min(...paths.map(([a, b]) => segmentDistance(point(w, node), a, b)));
          expect(nearest).toBeLessThanOrEqual(EMISSION_HALO_METERS + 1e-6);
        }
      });
    }
    expect(litFrames).toBeGreaterThan(40);
  });

  it('flashes lesioned nodes red for 0.35 s and regrown nodes for 0.8 s', () => {
    // Visit the fault, then leave for the shelter so lesions regrow.
    const w = new HomeWorld(model, COURTYARD, 1, { goal: 'fault' });
    while (w.tick < 1200 && !w.events.some((event) => event.kind === 'lesion')) w.step();
    expect(w.events.some((event) => event.kind === 'lesion')).toBe(true);
    const lesioned = Array.from(w.nodeLesionTick).findIndex((t) => t === w.tick);
    expect(lesioned).toBeGreaterThanOrEqual(0);
    const flash = computeHomeEmission(w, LOOK).nodeColors;
    expect(flash[lesioned * 3]!).toBeGreaterThan(flash[lesioned * 3 + 2]!);
    w.setGoal('shelter');
    let regrown = -1;
    for (let tick = 0; tick < 1500 && regrown < 0; tick += 1) {
      w.step();
      regrown = Array.from(w.nodeRegrowTick).findIndex((t) => t === w.tick);
    }
    expect(regrown).toBeGreaterThanOrEqual(0);
    expect(lit(computeHomeEmission(w, LOOK), regrown)).toBe(true);
  });
});
