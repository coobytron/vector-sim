import { hashState } from '../../simulation/hashState';
import { SeededRandom } from '../../simulation/prng';
import { CheckpointValidationError } from '../checkpoint/types';
import type { LoadedCheckpoint } from '../checkpoint/types';
import { VectorNcaReferenceKernel } from './vectorNcaKernel';

export interface ReferenceRuntimeOptions {
  readonly checkpoint: LoadedCheckpoint;
  readonly nodes: number;
  /** Seeds the initial latent state and any lesion selection. */
  readonly seed: number;
  /** Optional fixed sensor field, `nodes × sensorChannels`. Defaults to zeros. */
  readonly sensors?: Float32Array;
  /** Throw as soon as the state stops being finite. Default `true`. */
  readonly guardNonFinite?: boolean;
}

export interface LesionRequest {
  /** Explicit node indices to clear. Takes precedence over `fraction`. */
  readonly nodeIndices?: readonly number[];
  /** Fraction of nodes to clear, selected deterministically from `seed`. */
  readonly fraction?: number;
  /** Overrides the runtime seed for selection only. */
  readonly seed?: number;
}

export interface ReferenceRuntime {
  readonly latentChannels: number;
  readonly sensorChannels: number;
  readonly nodes: number;
  readonly tick: number;
  readonly paused: boolean;
  /** Live view of the current latent state; do not mutate. */
  readonly state: Float32Array;
  /** Node indices cleared by the most recent lesion, ascending. */
  readonly lesionedNodes: readonly number[];
  pause(): void;
  resume(): void;
  /** Advances `steps` ticks. A paused runtime advances nothing. */
  step(steps?: number): number;
  /** Ignores the paused flag — the single-step control. */
  stepOnce(): number;
  /** Returns to tick 0 with the current seed. */
  reset(): void;
  /** Returns to tick 0 with a new seed. */
  reseed(seed: number): void;
  setSensors(sensors: Float32Array): void;
  applyLesion(request: LesionRequest): readonly number[];
  /** Stable hash of `(tick, state)` — the fixture signature. */
  signature(): string;
}

export class ReferenceRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceRuntimeError';
  }
}

/**
 * Deterministic initial state. Small bounded values keep the untrained smoke
 * checkpoint inside tanh's useful range without pretending to be a learned
 * seeding strategy.
 */
function seedLatent(target: Float32Array, seed: number): void {
  const random = new SeededRandom(seed);
  for (let index = 0; index < target.length; index += 1) {
    target[index] = random.signed() * 0.1;
  }
}

/**
 * Wraps a loaded checkpoint in the transport controls the browser runtime and
 * CI fixtures both need: pause, single-step, reset, reseed, and lesion.
 *
 * Every control is a pure function of `(checkpoint, nodes, seed, sensors,
 * lesions applied)` — no wall clock, no unseeded randomness.
 */
export function createReferenceRuntime(options: ReferenceRuntimeOptions): ReferenceRuntime {
  const { checkpoint, nodes } = options;
  if (!Number.isInteger(nodes) || nodes <= 0) {
    throw new ReferenceRuntimeError(`nodes must be a positive integer (got ${nodes})`);
  }

  const kernel = new VectorNcaReferenceKernel(checkpoint);
  const guardNonFinite = options.guardNonFinite ?? true;
  const latentSize = nodes * kernel.latentChannels;
  const sensorSize = nodes * kernel.sensorChannels;

  let current = new Float32Array(latentSize);
  let scratch = new Float32Array(latentSize);
  let sensors = new Float32Array(sensorSize);
  let seed = options.seed;
  let tick = 0;
  let paused = false;
  let lesionedNodes: number[] = [];

  if (options.sensors !== undefined) {
    if (options.sensors.length !== sensorSize) {
      throw new ReferenceRuntimeError(
        `sensors must hold ${sensorSize} values (nodes × sensorChannels), got ${options.sensors.length}`,
      );
    }
    sensors = Float32Array.from(options.sensors);
  }

  seedLatent(current, seed);

  function advance(): number {
    kernel.step(current, sensors, nodes, scratch);
    const next = scratch;
    scratch = current;
    current = next;
    tick += 1;

    if (guardNonFinite) {
      for (let index = 0; index < current.length; index += 1) {
        if (!Number.isFinite(current[index] as number)) {
          throw new CheckpointValidationError(
            'corrupt',
            `state element ${index} became non-finite at tick ${tick}`,
          );
        }
      }
    }
    return tick;
  }

  return {
    latentChannels: kernel.latentChannels,
    sensorChannels: kernel.sensorChannels,
    nodes,
    get tick() {
      return tick;
    },
    get paused() {
      return paused;
    },
    get state() {
      return current;
    },
    get lesionedNodes() {
      return lesionedNodes;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    step(steps = 1) {
      if (!Number.isInteger(steps) || steps < 0) {
        throw new ReferenceRuntimeError(`steps must be a non-negative integer (got ${steps})`);
      }
      if (paused) {
        return tick;
      }
      for (let index = 0; index < steps; index += 1) {
        advance();
      }
      return tick;
    },
    stepOnce() {
      return advance();
    },
    reset() {
      tick = 0;
      lesionedNodes = [];
      seedLatent(current, seed);
    },
    reseed(nextSeed: number) {
      seed = nextSeed;
      tick = 0;
      lesionedNodes = [];
      seedLatent(current, seed);
    },
    setSensors(nextSensors: Float32Array) {
      if (nextSensors.length !== sensorSize) {
        throw new ReferenceRuntimeError(
          `sensors must hold ${sensorSize} values (nodes × sensorChannels), got ${nextSensors.length}`,
        );
      }
      sensors.set(nextSensors);
    },
    applyLesion(request: LesionRequest) {
      let selected: number[];

      if (request.nodeIndices !== undefined) {
        selected = [...new Set(request.nodeIndices)].sort((a, b) => a - b);
        for (const node of selected) {
          if (!Number.isInteger(node) || node < 0 || node >= nodes) {
            throw new ReferenceRuntimeError(`lesion node ${node} is outside [0, ${nodes})`);
          }
        }
      } else {
        const fraction = request.fraction ?? 0;
        if (!(fraction >= 0 && fraction <= 1)) {
          throw new ReferenceRuntimeError(`lesion fraction must be within [0, 1] (got ${fraction})`);
        }
        // Deterministic selection: score every node from the seed, then take
        // the lowest scores in ascending node order.
        const random = new SeededRandom(request.seed ?? seed);
        const scored = Array.from({ length: nodes }, (_unused, node) => ({
          node,
          score: random.next(),
        }));
        scored.sort((a, b) => (a.score === b.score ? a.node - b.node : a.score - b.score));
        selected = scored
          .slice(0, Math.round(fraction * nodes))
          .map((entry) => entry.node)
          .sort((a, b) => a - b);
      }

      for (const node of selected) {
        current.fill(0, node * kernel.latentChannels, (node + 1) * kernel.latentChannels);
      }
      lesionedNodes = selected;
      return selected;
    },
    signature() {
      return hashState([current], tick);
    },
  };
}
