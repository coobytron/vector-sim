import { hashState } from '../simulation/hashState';
import { branchingRestPose } from '../organisms/morphology';
import {
  ALIVE_CHANNEL,
  createGraphNcaStepper,
  graphNcaSeedState,
} from '../nca/graph/graphNcaRuntime';
import type { GraphNcaModel, GraphNcaStepper } from '../nca/graph/graphNcaRuntime';

/**
 * M2 graybox loop: one M1 graph-NCA organism in one box room with a food doorway,
 * a kill wall and one neutral obstacle. Everything is deterministic for a seed.
 *
 * Fields reach the NCA only through its trained sensors: F (food, >= 0) near the
 * doorway and K (kill, <= 0) near the kill wall. The detour around the obstacle
 * brushes the kill wall: nodes deep in its band are destroyed each tick, and the
 * NCA regrows them once the organism has moved on.
 * Locomotion is a hand-authored steering rule on the organism root: head for the
 * doorway, detouring around the obstacle via its nearer corner, then collide.
 */

export interface Box2 {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface GrayboxLayout {
  /** Interior of the room in the xz plane; floor at y = 0. */
  readonly room: Box2;
  readonly height: number;
  /** Doorway opening on the +x wall, spanning `doorway.minZ..maxZ`. */
  readonly doorway: { readonly x: number; readonly minZ: number; readonly maxZ: number; readonly height: number };
  /** The +z wall kills within `killBand` of its plane. */
  readonly killWallZ: number;
  readonly killBand: number;
  /** F falls to zero `foodReach` from the doorway opening. */
  readonly foodReach: number;
  readonly obstacle: Box2;
  readonly spawn: { readonly x: number; readonly z: number };
}

export const DEFAULT_GRAYBOX_LAYOUT: GrayboxLayout = {
  room: { minX: -3, maxX: 3, minZ: -2, maxZ: 2 },
  height: 2.2,
  doorway: { x: 3, minZ: -0.6, maxZ: 0.6, height: 1.8 },
  killWallZ: 2,
  killBand: 1,
  foodReach: 1.6,
  obstacle: { minX: -0.5, maxX: 0.5, minZ: -0.7, maxZ: 0.7 },
  spawn: { x: -2.2, z: 0.35 },
};

/** Field strengths, chosen inside the M1 training range (amplitude 0.3–1.0). */
const FOOD_AMPLITUDE = 0.8;
const KILL_AMPLITUDE = 0.8;
/** A node whose K sensor reads below this is destroyed for the tick. */
const KILL_THRESHOLD = -0.4;
/** Organism footprint radius used for collision (rest pose spans about ±0.45). */
const BODY_RADIUS = 0.5;
const MAX_SPEED = 0.012;
/** The organism stays put until this fraction of its nodes is alive. */
const MOBILE_FRACTION = 0.6;
const ENERGY_GAIN = 0.00005;
const ENERGY_DECAY = 0.0002;
const NEUTRAL_REST = [0, 0, 0, 1, 1, 0] as const;
const FIRE_STREAM = 11;

export type GrayboxEventKind = 'spawn' | 'damage' | 'feed' | 'regrow';

export interface GrayboxEvent {
  readonly kind: GrayboxEventKind;
  readonly tick: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function foodField(layout: GrayboxLayout, x: number, z: number): number {
  const { doorway } = layout;
  const dz = z < doorway.minZ ? doorway.minZ - z : z > doorway.maxZ ? z - doorway.maxZ : 0;
  const distance = Math.hypot(doorway.x - x, dz);
  return FOOD_AMPLITUDE * clamp(1 - distance / layout.foodReach, 0, 1);
}

export function killField(layout: GrayboxLayout, z: number): number {
  const distance = layout.killWallZ - z;
  return -KILL_AMPLITUDE * clamp(1 - distance / layout.killBand, 0, 1);
}

/** True when the segment a→b passes through the obstacle inflated by BODY_RADIUS (slab test). */
function segmentBlocked(layout: GrayboxLayout, ax: number, az: number, bx: number, bz: number): boolean {
  const { obstacle } = layout;
  const minX = obstacle.minX - BODY_RADIUS;
  const maxX = obstacle.maxX + BODY_RADIUS;
  const minZ = obstacle.minZ - BODY_RADIUS;
  const maxZ = obstacle.maxZ + BODY_RADIUS;
  let t0 = 0;
  let t1 = 1;
  for (const [origin, delta, low, high] of [[ax, bx - ax, minX, maxX], [az, bz - az, minZ, maxZ]] as const) {
    if (Math.abs(delta) < 1e-12) {
      if (origin <= low || origin >= high) return false;
      continue;
    }
    let near = (low - origin) / delta;
    let far = (high - origin) / delta;
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near);
    t1 = Math.min(t1, far);
    if (t0 >= t1) return false;
  }
  return true;
}

/**
 * Steering target: the doorway when the way is clear, otherwise the nearer corner
 * of the inflated obstacle on the organism's side (ties go to +z).
 */
function steeringTarget(layout: GrayboxLayout, x: number, z: number): { x: number; z: number } {
  const { doorway, obstacle } = layout;
  const goal = { x: doorway.x - BODY_RADIUS, z: clamp(z, doorway.minZ + 0.1, doorway.maxZ - 0.1) };
  if (!segmentBlocked(layout, x, z, goal.x, goal.z)) return goal;
  const margin = BODY_RADIUS + 0.15;
  const sideZ = z >= (obstacle.minZ + obstacle.maxZ) / 2 ? obstacle.maxZ + margin : obstacle.minZ - margin;
  const nearX = obstacle.minX - margin;
  if (x < nearX && Math.abs(z - sideZ) > 0.05) return { x: nearX, z: sideZ };
  return { x: obstacle.maxX + margin, z: sideZ };
}

/** Pushes a disc of BODY_RADIUS out of the obstacle and back inside the room. */
function resolveCollisions(layout: GrayboxLayout, position: { x: number; z: number }): void {
  const { obstacle, room } = layout;
  const cx = clamp(position.x, obstacle.minX, obstacle.maxX);
  const cz = clamp(position.z, obstacle.minZ, obstacle.maxZ);
  const dx = position.x - cx;
  const dz = position.z - cz;
  const distance = Math.hypot(dx, dz);
  if (distance < BODY_RADIUS) {
    if (distance > 1e-9) {
      position.x = cx + (dx / distance) * BODY_RADIUS;
      position.z = cz + (dz / distance) * BODY_RADIUS;
    } else {
      position.z = position.z >= 0 ? obstacle.maxZ + BODY_RADIUS : obstacle.minZ - BODY_RADIUS;
    }
  }
  position.x = clamp(position.x, room.minX + BODY_RADIUS, room.maxX - BODY_RADIUS);
  position.z = clamp(position.z, room.minZ + BODY_RADIUS, room.maxZ - BODY_RADIUS);
}

export interface GrayboxSnapshot {
  readonly tick: number;
  readonly aliveNodes: number;
  readonly energy: number;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly killedThisTick: number;
  readonly foodIntake: number;
}

export class GrayboxWorld {
  readonly layout: GrayboxLayout;
  readonly model: GraphNcaModel;
  readonly seed: number;
  /** Rest pose in organism-local coordinates (x, y, z per node). */
  readonly restPositions: Float32Array;
  /** World-space node positions, refreshed every tick. */
  readonly positions: Float32Array;
  readonly state: Float32Array;
  readonly sensors: Float32Array;
  readonly events: GrayboxEvent[] = [];

  private readonly stepper: GraphNcaStepper;
  private readonly body = new Float32Array(4); // x, z, heading, energy
  private currentTick = 0;
  private killedThisTick = 0;
  private foodIntake = 0;
  private damaged = false;

  constructor(model: GraphNcaModel, seed: number, layout: GrayboxLayout = DEFAULT_GRAYBOX_LAYOUT) {
    const pose = branchingRestPose(model.nodes);
    if (pose.parents.some((parent, node) => parent !== model.parents[node])) {
      throw new Error('graybox: model topology does not match the Branching rest pose');
    }
    this.layout = layout;
    this.model = model;
    this.seed = seed >>> 0;
    this.restPositions = pose.positions;
    this.positions = new Float32Array(model.nodes * 3);
    this.state = graphNcaSeedState(model);
    this.sensors = new Float32Array(model.nodes * model.sensorChannels);
    this.stepper = createGraphNcaStepper(model, this.seed, FIRE_STREAM);
    this.body[0] = layout.spawn.x;
    this.body[1] = layout.spawn.z;
    this.body[2] = 0;
    this.body[3] = 0;
    this.updatePositions();
    this.events.push({ kind: 'spawn', tick: 0 });
  }

  get tick(): number {
    return this.currentTick;
  }

  aliveNodes(): number {
    let count = 0;
    for (let node = 0; node < this.model.nodes; node += 1) {
      if (this.state[node * this.model.channels + ALIVE_CHANNEL]! > this.model.aliveThreshold) count += 1;
    }
    return count;
  }

  snapshot(): GrayboxSnapshot {
    return {
      tick: this.currentTick,
      aliveNodes: this.aliveNodes(),
      energy: this.body[3]!,
      x: this.body[0]!,
      z: this.body[1]!,
      heading: this.body[2]!,
      killedThisTick: this.killedThisTick,
      foodIntake: this.foodIntake,
    };
  }

  /** Hash of (tick, NCA state, body) — the M2 determinism signature. */
  signature(): string {
    return hashState([this.state, this.body], this.currentTick);
  }

  step(ticks = 1): void {
    for (let index = 0; index < ticks; index += 1) this.stepOnce();
  }

  private updatePositions(): void {
    const x = this.body[0]!;
    const z = this.body[1]!;
    const cos = Math.cos(this.body[2]!);
    const sin = Math.sin(this.body[2]!);
    for (let node = 0; node < this.model.nodes; node += 1) {
      const lx = this.restPositions[node * 3]!;
      const ly = this.restPositions[node * 3 + 1]!;
      const lz = this.restPositions[node * 3 + 2]!;
      this.positions[node * 3] = Math.fround(x + lx * cos - lz * sin);
      this.positions[node * 3 + 1] = ly;
      this.positions[node * 3 + 2] = Math.fround(z + lx * sin + lz * cos);
    }
  }

  private sampleSensors(): void {
    const { sensorChannels } = this.model;
    for (let node = 0; node < this.model.nodes; node += 1) {
      const x = this.positions[node * 3]!;
      const z = this.positions[node * 3 + 2]!;
      const base = node * sensorChannels;
      for (let channel = 0; channel < sensorChannels; channel += 1) {
        this.sensors[base + channel] = NEUTRAL_REST[channel] ?? 0;
      }
      this.sensors[base] = foodField(this.layout, x, z);
      this.sensors[base + 1] = killField(this.layout, z);
    }
  }

  private stepOnce(): void {
    const tick = this.currentTick;
    const { channels, nodes } = this.model;
    this.sampleSensors();
    this.stepper.step(this.state, this.sensors, tick);

    // Kill wall: nodes deep in the band are destroyed this tick.
    let killed = 0;
    for (let node = 0; node < nodes; node += 1) {
      const base = node * channels;
      if (this.sensors[node * this.model.sensorChannels + 1]! >= KILL_THRESHOLD) continue;
      if (this.state[base + ALIVE_CHANNEL]! <= 0) continue;
      this.state.fill(0, base, base + channels);
      killed += 1;
    }
    this.killedThisTick = killed;
    if (killed > 0 && !this.damaged) {
      this.damaged = true;
      this.events.push({ kind: 'damage', tick: tick + 1 });
    }

    // Feeding: living nodes inside the food field add energy.
    let intake = 0;
    for (let node = 0; node < nodes; node += 1) {
      if (this.state[node * channels + ALIVE_CHANNEL]! <= this.model.aliveThreshold) continue;
      intake += this.sensors[node * this.model.sensorChannels]!;
    }
    this.foodIntake = intake;
    const energy = Math.fround(clamp(this.body[3]! + intake * ENERGY_GAIN - ENERGY_DECAY, 0, 1));
    if (intake > 0 && !this.events.some((event) => event.kind === 'feed')) {
      this.events.push({ kind: 'feed', tick: tick + 1 });
    }
    this.body[3] = energy;

    const alive = this.aliveNodes();
    if (this.damaged && alive === nodes && !this.events.some((event) => event.kind === 'regrow')) {
      this.events.push({ kind: 'regrow', tick: tick + 1 });
    }

    // Steering: move once grown enough, towards the steering target, then collide.
    const mobility = clamp((alive / nodes - MOBILE_FRACTION) / (1 - MOBILE_FRACTION), 0, 1);
    if (mobility > 0) {
      const x = this.body[0]!;
      const z = this.body[1]!;
      const target = steeringTarget(this.layout, x, z);
      const gx = target.x - x;
      const gz = target.z - z;
      const length = Math.hypot(gx, gz);
      // Slow down while feeding so the organism settles at the doorway.
      const speed = MAX_SPEED * mobility * clamp(1 - intake / nodes / (FOOD_AMPLITUDE * 0.5), 0, 1);
      if (length > 1e-6 && speed > 0) {
        const stride = Math.min(speed, length);
        const next = { x: x + (gx / length) * stride, z: z + (gz / length) * stride };
        resolveCollisions(this.layout, next);
        const targetHeading = Math.atan2(gz, gx);
        let turn = targetHeading - this.body[2]!;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        this.body[0] = Math.fround(next.x);
        this.body[1] = Math.fround(next.z);
        this.body[2] = Math.fround(this.body[2]! + clamp(turn, -0.03, 0.03));
      }
    }

    this.currentTick = tick + 1;
    this.updatePositions();
  }
}
