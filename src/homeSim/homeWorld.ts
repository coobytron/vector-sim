import { vec3 } from '../environments/fields';
import type { FieldProvider } from '../environments/fields';
import { createHomePresetFieldProvider } from '../environments/homePresets';
import type { HomePresetManifest } from '../environments/homePresets';
import { createLifecycleSystem } from '../lifecycle';
import type { LifecycleSystem, OrganismLifecycleState } from '../lifecycle';
import {
  ALIVE_CHANNEL,
  createGraphNcaStepper,
  graphNcaSeedState,
} from '../nca/graph/graphNcaRuntime';
import type { GraphNcaModel, GraphNcaStepper } from '../nca/graph/graphNcaRuntime';
import { branchingRestPose } from '../organisms/morphology';
import { hashState } from '../simulation/hashState';
import { counterRandom } from '../simulation/prng';
import { HomeNavGrid, clearance, createHomeColliders, resolveDisc } from './homeColliders';
import type { HomeColliders } from './homeColliders';

/**
 * M3: one M1 graph-NCA organism in a real Home preset.
 *
 * - Fields come from the preset's shared provider: `energy` (food), `danger`
 *   (kill) and `shelter`. Each node reads them at its own position through the
 *   trained F/K sensors, so food and kill act locally on the NCA.
 * - Nodes whose danger reaches LESION_DANGER are destroyed for the tick; the
 *   NCA regrows them once the organism leaves.
 * - Energy and health come from the existing lifecycle system, sampled at the
 *   living-node centroid: intake, damage, shelter-reduced idle drain.
 * - Neutral geometry (walls, stair, table legs, perimeter) only collides; it
 *   never touches energy or health.
 * - Locomotion is hand-authored: a grid path to the current goal.
 */

/** Organism rest pose is scaled into metres. */
export const HOME_ORGANISM_SCALE = 0.3;
const REST_HEIGHT = 1.12;
const REST_RADIUS = 0.45;
export const HOME_BODY_RADIUS = REST_RADIUS * HOME_ORGANISM_SCALE;
/** Spawn rules from the Home approval checklist. */
export const SPAWN_CLEARANCE_METERS = 0.2;
export const SPAWN_MAX_KILL = 0.05;
export const SPAWN_MAX_FOOD = 0.1;
const LESION_DANGER = 0.4;
const MAX_SPEED = 0.006; // metres per tick (0.18 m/s at 30 Hz)
const MOBILE_FRACTION = 0.6;
const FIRE_STREAM = 13;
const SENSORS_REST = [0, 0, 0, 1, 1, 0] as const;

export type HomeGoalId = 'food' | 'fault' | 'shelter' | 'stay';

export interface HomeGoal {
  readonly id: HomeGoalId;
  readonly x: number;
  readonly z: number;
}

export type HomeWorldEventKind = 'spawn' | 'lesion' | 'feed' | 'damage' | 'regrow' | 'death';

export interface HomeWorldEvent {
  readonly kind: HomeWorldEventKind;
  readonly tick: number;
  readonly sourceIds: readonly string[];
}

export interface HomeWorldInput {
  readonly tick: number;
  readonly goal: HomeGoalId;
}

export interface HomeContact {
  readonly sourceId: string;
  /** Closest point on the authored source. */
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
  /** Organism node receiving the contact. */
  readonly node: number;
  readonly value: number;
}

export interface HomeWorldOptions {
  readonly provider?: FieldProvider;
  /** Overrides the spawn search (tests place the organism directly). */
  readonly spawn?: { readonly x: number; readonly z: number };
  readonly goal?: HomeGoalId;
}

export interface HomeWorldSnapshot {
  readonly tick: number;
  readonly aliveNodes: number;
  readonly x: number;
  readonly z: number;
  readonly energy: number;
  readonly health: number;
  readonly status: string;
  readonly food: number;
  readonly danger: number;
  readonly shelter: number;
  readonly lesionedThisTick: number;
  readonly goal: HomeGoalId;
}

function contactFor(
  contacts: readonly { readonly sourceId: string; readonly point: { x: number; y: number; z: number }; readonly contribution: number }[] | undefined,
  node: number,
  value: number,
): HomeContact | null {
  if (!contacts || contacts.length === 0) return null;
  let best = contacts[0]!;
  for (const contact of contacts) if (contact.contribution > best.contribution) best = contact;
  return { sourceId: best.sourceId, point: { x: best.point.x, y: best.point.y, z: best.point.z }, node, value };
}

function sourceCenter(preset: HomePresetManifest, id: string): { x: number; z: number } {
  const source = preset.effectSources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`Home preset ${preset.id} has no source ${id}`);
  const geometry = source.geometry;
  switch (geometry.kind) {
    case 'sphere': return { x: geometry.center.x, z: geometry.center.z };
    case 'box': return { x: geometry.center.x, z: geometry.center.z };
    case 'point': return { x: geometry.position.x, z: geometry.position.z };
    case 'capsule': return { x: (geometry.start.x + geometry.end.x) / 2, z: (geometry.start.z + geometry.end.z) / 2 };
    case 'plane': return { x: geometry.origin.x, z: geometry.origin.z };
  }
}

/** Goal points for a preset: the strongest reachable food, the strongest kill, the first shelter. */
export function homeGoals(preset: HomePresetManifest): Readonly<Record<Exclude<HomeGoalId, 'stay'>, { x: number; z: number }>> {
  const byStrength = [...preset.effectSources].sort((a, b) => a.strength - b.strength || (a.id < b.id ? -1 : 1));
  // Food sources the floor organism can reach: the source sits within reach of the body's height band.
  const reach = REST_HEIGHT * HOME_ORGANISM_SCALE;
  const reachable = byStrength.filter((source) => source.strength > 0 && (source.geometry.kind !== 'sphere'
    || source.geometry.center.y - source.geometry.radiusMeters - source.rangeMeters < reach));
  const food = reachable[reachable.length - 1];
  const fault = byStrength[0];
  const shelter = preset.shelterRegions[0];
  if (!food || !fault || fault.strength >= 0 || !shelter) throw new Error(`Home preset ${preset.id} lacks food, fault or shelter`);
  return {
    food: sourceCenter(preset, food.id),
    fault: sourceCenter(preset, fault.id),
    shelter: { x: shelter.center.x, z: shelter.center.z },
  };
}

export class HomeWorld {
  readonly preset: HomePresetManifest;
  readonly model: GraphNcaModel;
  readonly seed: number;
  readonly colliders: HomeColliders;
  readonly nav: HomeNavGrid;
  readonly provider: FieldProvider;
  readonly restPositions: Float32Array;
  readonly positions: Float32Array;
  readonly state: Float32Array;
  readonly sensors: Float32Array;
  /** Per-node danger read this tick, `[0, 1]`. */
  readonly nodeDanger: Float32Array;
  readonly nodeFood: Float32Array;
  readonly events: HomeWorldEvent[] = [];
  /** Goal changes in order, as `(tick, goal)`, starting with the initial goal at tick 0: the input timeline replay needs. */
  readonly inputs: HomeWorldInput[] = [];
  /** Tick a node was last destroyed by kill exposure, or -1. */
  readonly nodeLesionTick: Int32Array;
  /** Tick a previously lesioned node last came back alive, or -1. */
  readonly nodeRegrowTick: Int32Array;
  /** Where food and kill touch the organism this tick (strongest node), or null. */
  foodContact: HomeContact | null = null;
  killContact: HomeContact | null = null;
  /** Whether the lifecycle reported intake / damage on the last tick. */
  fedThisTick = false;
  damagedThisTick = false;
  readonly spawnPoint: { readonly x: number; readonly z: number };

  private readonly stepper: GraphNcaStepper;
  private readonly lifecycle: LifecycleSystem;
  private readonly body = new Float32Array(3); // x, z, heading
  private readonly goals: ReturnType<typeof homeGoals>;
  private goalId: HomeGoalId;
  private cost: Float32Array | null = null;
  private currentTick = 0;
  private lesioned = 0;
  private lesionedEver = false;
  private readonly wasAlive: Uint8Array;

  constructor(model: GraphNcaModel, preset: HomePresetManifest, seed: number, options: HomeWorldOptions = {}) {
    const pose = branchingRestPose(model.nodes);
    if (pose.parents.some((parent, node) => parent !== model.parents[node])) {
      throw new Error('home: model topology does not match the Branching rest pose');
    }
    this.model = model;
    this.preset = preset;
    this.seed = seed >>> 0;
    this.provider = options.provider ?? createHomePresetFieldProvider(preset);
    this.colliders = createHomeColliders(preset, REST_HEIGHT * HOME_ORGANISM_SCALE);
    this.nav = new HomeNavGrid(this.colliders, HOME_BODY_RADIUS);
    this.goals = homeGoals(preset);
    this.restPositions = pose.positions.map((value) => Math.fround(value * HOME_ORGANISM_SCALE));
    this.positions = new Float32Array(model.nodes * 3);
    this.state = graphNcaSeedState(model);
    this.sensors = new Float32Array(model.nodes * model.sensorChannels);
    this.nodeDanger = new Float32Array(model.nodes);
    this.nodeFood = new Float32Array(model.nodes);
    this.nodeLesionTick = new Int32Array(model.nodes).fill(-1);
    this.nodeRegrowTick = new Int32Array(model.nodes).fill(-1);
    this.wasAlive = new Uint8Array(model.nodes);
    this.stepper = createGraphNcaStepper(model, this.seed, FIRE_STREAM);

    this.spawnPoint = options.spawn ?? this.findSpawn();
    this.body[0] = this.spawnPoint.x;
    this.body[1] = this.spawnPoint.z;
    this.updatePositions();

    this.lifecycle = createLifecycleSystem({ provider: this.provider, rates: { maxPopulation: 1 } });
    this.lifecycle.spawn({ id: 'organism-0', seed: this.seed, phenotype: model.phenotype, position: this.centroid() });
    this.goalId = options.goal ?? 'food';
    this.inputs.push({ tick: 0, goal: this.goalId });
    this.events.push({ kind: 'spawn', tick: 0, sourceIds: [] });
  }

  get tick(): number {
    return this.currentTick;
  }

  get goal(): HomeGoalId {
    return this.goalId;
  }

  setGoal(goal: HomeGoalId): void {
    if (goal === this.goalId) return;
    this.inputs.push({ tick: this.currentTick, goal });
    this.goalId = goal;
    this.cost = null;
  }

  goalPoint(goal: Exclude<HomeGoalId, 'stay'>): { x: number; z: number } {
    return this.goals[goal];
  }

  organism(): OrganismLifecycleState {
    return this.lifecycle.get('organism-0')!;
  }

  aliveNodes(): number {
    let count = 0;
    for (let node = 0; node < this.model.nodes; node += 1) {
      if (this.state[node * this.model.channels + ALIVE_CHANNEL]! > this.model.aliveThreshold) count += 1;
    }
    return count;
  }

  snapshot(): HomeWorldSnapshot {
    const organism = this.organism();
    return {
      tick: this.currentTick,
      aliveNodes: this.aliveNodes(),
      x: this.body[0]!,
      z: this.body[1]!,
      energy: organism.energy,
      health: organism.viability,
      status: organism.status,
      food: organism.sample.energy,
      danger: organism.sample.danger,
      shelter: organism.sample.shelter ?? 0,
      lesionedThisTick: this.lesioned,
      goal: this.goalId,
    };
  }

  /** Hash of (tick, NCA state, body, energy, damage) — the M3 determinism signature. */
  signature(): string {
    const organism = this.organism();
    const metabolism = Float32Array.of(organism.energy, organism.damage);
    return hashState([this.state, this.body, metabolism], this.currentTick);
  }

  step(ticks = 1): void {
    for (let index = 0; index < ticks; index += 1) this.stepOnce();
  }

  /**
   * Deterministic spawn search inside the preset's first spawn region: candidates
   * on a 0.1 m grid, visited in seeded order, accepting the first with 0.20 m
   * clearance, kill ≤ 0.05 and food ≤ 0.10 at the organism's footprint.
   */
  private findSpawn(): { x: number; z: number } {
    const region = this.preset.spawnRegions[0];
    if (!region) throw new Error(`Home preset ${this.preset.id} has no spawn region`);
    const candidates: { x: number; z: number; order: number }[] = [];
    const step = 0.1;
    let index = 0;
    for (let x = region.center.x - region.halfExtentsMeters.x; x <= region.center.x + region.halfExtentsMeters.x + 1e-9; x += step) {
      for (let z = region.center.z - region.halfExtentsMeters.z; z <= region.center.z + region.halfExtentsMeters.z + 1e-9; z += step) {
        candidates.push({ x: Math.fround(x), z: Math.fround(z), order: counterRandom(this.seed, 0, index, 0, 7) });
        index += 1;
      }
    }
    candidates.sort((a, b) => a.order - b.order);
    for (const candidate of candidates) {
      if (clearance(this.colliders, candidate.x, candidate.z, HOME_BODY_RADIUS) < SPAWN_CLEARANCE_METERS) continue;
      if (!this.footprintIsCalm(candidate.x, candidate.z)) continue;
      return { x: candidate.x, z: candidate.z };
    }
    throw new Error(`Home preset ${this.preset.id}: no valid spawn in ${region.id}`);
  }

  private footprintIsCalm(x: number, z: number): boolean {
    const height = REST_HEIGHT * HOME_ORGANISM_SCALE;
    const probes = [[0, 0], [HOME_BODY_RADIUS, 0], [-HOME_BODY_RADIUS, 0], [0, HOME_BODY_RADIUS], [0, -HOME_BODY_RADIUS]] as const;
    for (const [dx, dz] of probes) {
      for (const y of [0.05, height / 2, height]) {
        const sample = this.provider.sample(vec3(x + dx, this.colliders.floorY + y, z + dz));
        if ((sample.scalars.danger ?? 0) > SPAWN_MAX_KILL || (sample.scalars.energy ?? 0) > SPAWN_MAX_FOOD) return false;
      }
    }
    return true;
  }

  private updatePositions(): void {
    const x = this.body[0]!;
    const z = this.body[1]!;
    const cos = Math.cos(this.body[2]!);
    const sin = Math.sin(this.body[2]!);
    const floorY = this.colliders.floorY;
    for (let node = 0; node < this.model.nodes; node += 1) {
      const lx = this.restPositions[node * 3]!;
      const ly = this.restPositions[node * 3 + 1]!;
      const lz = this.restPositions[node * 3 + 2]!;
      this.positions[node * 3] = Math.fround(x + lx * cos - lz * sin);
      this.positions[node * 3 + 1] = Math.fround(floorY + ly);
      this.positions[node * 3 + 2] = Math.fround(z + lx * sin + lz * cos);
    }
  }

  private centroid() {
    let x = 0;
    let y = 0;
    let z = 0;
    let count = 0;
    for (let node = 0; node < this.model.nodes; node += 1) {
      if (this.state[node * this.model.channels + ALIVE_CHANNEL]! <= this.model.aliveThreshold) continue;
      x += this.positions[node * 3]!;
      y += this.positions[node * 3 + 1]!;
      z += this.positions[node * 3 + 2]!;
      count += 1;
    }
    if (count === 0) return vec3(this.body[0]!, this.colliders.floorY, this.body[1]!);
    return vec3(x / count, y / count, z / count);
  }

  private sampleSensors(): void {
    const { sensorChannels } = this.model;
    this.foodContact = null;
    this.killContact = null;
    for (let node = 0; node < this.model.nodes; node += 1) {
      const sample = this.provider.sample(vec3(
        this.positions[node * 3]!,
        this.positions[node * 3 + 1]!,
        this.positions[node * 3 + 2]!,
      ));
      const food = sample.scalars.energy ?? 0;
      const danger = sample.scalars.danger ?? 0;
      this.nodeFood[node] = food;
      this.nodeDanger[node] = danger;
      if (food > (this.foodContact?.value ?? 0)) this.foodContact = contactFor(sample.channelContexts?.energy?.contacts, node, food);
      if (danger > (this.killContact?.value ?? 0)) this.killContact = contactFor(sample.channelContexts?.danger?.contacts, node, danger);
      const base = node * sensorChannels;
      for (let channel = 0; channel < sensorChannels; channel += 1) this.sensors[base + channel] = SENSORS_REST[channel] ?? 0;
      this.sensors[base] = food;
      this.sensors[base + 1] = -danger;
    }
  }

  private stepOnce(): void {
    const tick = this.currentTick;
    const { channels, nodes } = this.model;
    if (this.organism().status === 'dead') {
      // A dead organism keeps no living cells and never regrows from nothing.
      this.state.fill(0);
      this.lesioned = 0;
      this.fedThisTick = false;
      this.damagedThisTick = false;
      this.currentTick = tick + 1;
      return;
    }
    this.sampleSensors();
    this.stepper.step(this.state, this.sensors, tick);

    let lesioned = 0;
    for (let node = 0; node < nodes; node += 1) {
      if (this.nodeDanger[node]! < LESION_DANGER) continue;
      const base = node * channels;
      if (this.state[base + ALIVE_CHANNEL]! <= 0) continue;
      this.state.fill(0, base, base + channels);
      this.nodeLesionTick[node] = tick + 1;
      lesioned += 1;
    }
    for (let node = 0; node < nodes; node += 1) {
      const alive = this.state[node * channels + ALIVE_CHANNEL]! > this.model.aliveThreshold ? 1 : 0;
      if (alive && !this.wasAlive[node] && this.nodeLesionTick[node]! >= 0) this.nodeRegrowTick[node] = tick + 1;
      this.wasAlive[node] = alive;
    }
    this.lesioned = lesioned;
    if (lesioned > 0 && !this.lesionedEver) {
      this.lesionedEver = true;
      this.pushOnce('lesion', tick + 1, this.organism().sample.sourceIds);
    }

    this.lifecycle.clearEvents();
    this.lifecycle.moveTo('organism-0', this.centroid());
    this.lifecycle.step();
    this.fedThisTick = false;
    this.damagedThisTick = false;
    for (const event of this.lifecycle.events()) {
      if (event.kind === 'intake') this.fedThisTick = true;
      if (event.kind === 'damage') this.damagedThisTick = true;
      if (event.kind === 'intake') this.pushOnce('feed', tick + 1, event.sourceIds);
      if (event.kind === 'damage') this.pushOnce('damage', tick + 1, event.sourceIds);
      if (event.kind === 'death') this.pushOnce('death', tick + 1, event.sourceIds);
    }

    const alive = this.aliveNodes();
    if (this.lesionedEver && alive === nodes) this.pushOnce('regrow', tick + 1, []);

    this.steer(alive);
    this.currentTick = tick + 1;
    this.updatePositions();
  }

  private pushOnce(kind: HomeWorldEventKind, tick: number, sourceIds: readonly string[]): void {
    if (this.events.some((event) => event.kind === kind)) return;
    this.events.push({ kind, tick, sourceIds: [...sourceIds] });
  }

  private steer(alive: number): void {
    const mobility = Math.min(1, Math.max(0, (alive / this.model.nodes - MOBILE_FRACTION) / (1 - MOBILE_FRACTION)));
    if (mobility <= 0 || this.goalId === 'stay') return;
    const goal = this.goals[this.goalId];
    this.cost ??= this.nav.costField(goal.x, goal.z);
    const x = this.body[0]!;
    const z = this.body[1]!;
    const waypoint = this.nav.nextWaypoint(this.cost, x, z);
    if (!waypoint) return;
    const dx = waypoint.x - x;
    const dz = waypoint.z - z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return;
    const stride = Math.min(MAX_SPEED * mobility, length);
    const next = { x: x + (dx / length) * stride, z: z + (dz / length) * stride };
    resolveDisc(this.colliders, next, HOME_BODY_RADIUS);
    let turn = Math.atan2(dz, dx) - this.body[2]!;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.body[0] = Math.fround(next.x);
    this.body[1] = Math.fround(next.z);
    this.body[2] = Math.fround(this.body[2]! + Math.min(0.03, Math.max(-0.03, turn)));
  }
}
