import { spectralEmissionLinear } from '../spectral/color';
import { sampleSpectralEvent } from '../spectral/events';
import type { SpectralEvent } from '../spectral/events';
import type { SpectralLookProfile } from '../spectral/looks';
import type { HomeContact, HomeWorld } from './homeWorld';

/**
 * M4 causal emission for the Home organism. Colour is a pure function of the
 * world's events this tick, so an idle organism emits nothing:
 *
 * - feeding (blue): on ticks the lifecycle reports intake, nodes reading food, within a 0.25 m halo of the node the
 *   strongest food contact touches, plus a transfer line from the source.
 * - damage (red): on ticks the lifecycle reports damage, nodes reading kill near the kill contact, plus a line from
 *   the source, and a short flash on every node a lesion destroyed.
 * - regeneration (blue-green): a flash on every lesioned node that grows back.
 *
 * Windows follow the art direction: feed and regeneration cycles 0.8 s,
 * damage flashes 0.35 s.
 */

export const EMISSION_HALO_METERS = 0.25;
export const FEED_WINDOW_TICKS = 24;
export const DAMAGE_WINDOW_TICKS = 11;
export const REGROW_WINDOW_TICKS = 24;
/** Field readings below this never light a node. */
const MIN_READING = 0.01;

export interface HomeEmissionLine {
  readonly event: 'feeding' | 'damage';
  readonly sourceId: string;
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly color: readonly [number, number, number];
}

export interface HomeEmission {
  /** Linear RGB per node, `nodes × 3`; zero where nothing happens. */
  readonly nodeColors: Float32Array;
  readonly lines: readonly HomeEmissionLine[];
  /** Number of nodes with any emission. */
  readonly litNodes: number;
}

function nodePoint(world: HomeWorld, node: number): [number, number, number] {
  return [world.positions[node * 3]!, world.positions[node * 3 + 1]!, world.positions[node * 3 + 2]!];
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

function color(event: SpectralEvent, phase: number, strength: number, look: SpectralLookProfile): [number, number, number] {
  const sample = sampleSpectralEvent(event, phase);
  const rgb = spectralEmissionLinear(sample.wavelengthNm, sample.intensityScale * strength * look.emissionScale);
  return [rgb.r, rgb.g, rgb.b];
}

export function computeHomeEmission(world: HomeWorld, look: SpectralLookProfile): HomeEmission {
  const { nodes } = world.model;
  const tick = world.tick;
  const nodeColors = new Float32Array(nodes * 3);
  const lines: HomeEmissionLine[] = [];

  const add = (node: number, rgb: readonly number[]) => {
    nodeColors[node * 3] = nodeColors[node * 3]! + rgb[0]!;
    nodeColors[node * 3 + 1] = nodeColors[node * 3 + 1]! + rgb[1]!;
    nodeColors[node * 3 + 2] = nodeColors[node * 3 + 2]! + rgb[2]!;
  };

  const contactGlow = (contact: HomeContact | null, readings: Float32Array, event: 'feeding' | 'damage', phase: number) => {
    if (!contact || contact.value < MIN_READING) return;
    const target = nodePoint(world, contact.node);
    for (let node = 0; node < nodes; node += 1) {
      const reading = readings[node]!;
      if (reading < MIN_READING) continue;
      const d = distance(nodePoint(world, node), target);
      if (d > EMISSION_HALO_METERS) continue;
      add(node, color(event, phase, reading * (1 - d / EMISSION_HALO_METERS), look));
    }
    const from = [contact.point.x, contact.point.y, contact.point.z] as const;
    lines.push({ event, sourceId: contact.sourceId, from, to: target, color: color(event, phase, contact.value, look) });
  };

  if (world.fedThisTick) contactGlow(world.foodContact, world.nodeFood, 'feeding', (tick % FEED_WINDOW_TICKS) / FEED_WINDOW_TICKS);
  if (world.damagedThisTick) contactGlow(world.killContact, world.nodeDanger, 'damage', (tick % DAMAGE_WINDOW_TICKS) / DAMAGE_WINDOW_TICKS);
  for (let node = 0; node < nodes; node += 1) {
    const sinceLesion = tick - world.nodeLesionTick[node]!;
    if (world.nodeLesionTick[node]! >= 0 && sinceLesion < DAMAGE_WINDOW_TICKS) {
      add(node, color('damage', sinceLesion / DAMAGE_WINDOW_TICKS, 1, look));
    }
    const sinceRegrow = tick - world.nodeRegrowTick[node]!;
    if (world.nodeRegrowTick[node]! >= 0 && sinceRegrow < REGROW_WINDOW_TICKS) {
      add(node, color('regeneration', sinceRegrow / REGROW_WINDOW_TICKS, 1, look));
    }
  }

  let litNodes = 0;
  for (let node = 0; node < nodes; node += 1) {
    if (nodeColors[node * 3]! + nodeColors[node * 3 + 1]! + nodeColors[node * 3 + 2]! > 0) litNodes += 1;
  }
  return { nodeColors, lines, litNodes };
}
