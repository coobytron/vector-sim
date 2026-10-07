import { HOME_PRESETS } from '../environments/homePresets';
import type { HomePresetManifest } from '../environments/homePresets';
import type { GraphNcaModel } from '../nca/graph/graphNcaRuntime';
import { hashState } from '../simulation/hashState';
import type { SpectralLookName } from '../spectral/looks';
import { HomeWorld } from './homeWorld';
import type { HomeGoalId, HomeWorldInput } from './homeWorld';

/**
 * M4 replay and versioned state export. The world is a pure function of
 * (model, preset, seed, input timeline, tick), so a saved state stores those
 * plus the look and camera, and restoring replays the timeline and checks the
 * determinism signature against the saved hash.
 */

export const HOME_STATE_SCHEMA = 'vector-sim.home-state.v1';

const GOALS: readonly HomeGoalId[] = ['food', 'fault', 'shelter', 'stay'];
const LOOKS: readonly SpectralLookName[] = ['porcelain', 'technical', 'ghost'];

export interface HomeCameraState {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fovDegrees: number;
}

export interface HomeStateV1 {
  readonly schema: typeof HOME_STATE_SCHEMA;
  /** `modelFingerprint` of the weights the state was saved with. */
  readonly model: string;
  readonly presetId: string;
  readonly seed: number;
  readonly tick: number;
  readonly inputs: readonly HomeWorldInput[];
  readonly look: SpectralLookName;
  readonly camera: HomeCameraState;
  /** `HomeWorld.signature()` at `tick`. */
  readonly hash: string;
}

export class HomeStateError extends Error {}

/** Identifies the weights a state was saved with: phenotype plus a hash of every tensor. */
export function modelFingerprint(model: GraphNcaModel): string {
  return `${model.phenotype}:${hashState([model.w1, model.b1, model.w2], 0)}`;
}

/** Rebuilds a world from its seed and input timeline, stepped to `tick`. */
export function replayHomeWorld(
  model: GraphNcaModel,
  preset: HomePresetManifest,
  seed: number,
  inputs: readonly HomeWorldInput[],
  tick: number,
): HomeWorld {
  const [first, ...rest] = inputs;
  const world = new HomeWorld(model, preset, seed, { goal: first?.goal ?? 'food' });
  for (const input of rest) {
    if (input.tick > tick) break;
    world.step(input.tick - world.tick);
    world.setGoal(input.goal);
  }
  world.step(tick - world.tick);
  return world;
}

export function exportHomeState(world: HomeWorld, look: SpectralLookName, camera: HomeCameraState): HomeStateV1 {
  return {
    schema: HOME_STATE_SCHEMA,
    model: modelFingerprint(world.model),
    presetId: world.preset.id,
    seed: world.seed,
    tick: world.tick,
    inputs: world.inputs.map((input) => ({ tick: input.tick, goal: input.goal })),
    look,
    camera: {
      position: [...camera.position],
      target: [...camera.target],
      fovDegrees: camera.fovDegrees,
    },
    hash: world.signature(),
  };
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isTick(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Validates a parsed JSON value as a v1 Home state; throws `HomeStateError` with the first problem. */
export function parseHomeState(value: unknown): HomeStateV1 {
  const fail = (message: string): never => {
    throw new HomeStateError(`home state: ${message}`);
  };
  if (typeof value !== 'object' || value === null) fail('not an object');
  const state = value as Record<string, unknown>;
  if (state.schema !== HOME_STATE_SCHEMA) fail(`unsupported schema ${String(state.schema)}`);
  if (typeof state.model !== 'string') fail('model missing');
  if (typeof state.presetId !== 'string' || !(state.presetId in HOME_PRESETS)) fail(`unknown preset ${String(state.presetId)}`);
  if (!isTick(state.seed) || state.seed > 0xffffffff) fail('seed must be a uint32');
  if (!isTick(state.tick)) fail('tick must be a non-negative integer');
  if (!Array.isArray(state.inputs) || state.inputs.length === 0) fail('inputs must start with the tick-0 goal');
  let previous = 0;
  for (const [index, input] of (state.inputs as unknown[]).entries()) {
    const entry = input as Record<string, unknown> | null;
    if (!entry || !isTick(entry.tick) || !GOALS.includes(entry.goal as HomeGoalId)) fail(`input ${index} is malformed`);
    if ((index === 0 && entry!.tick !== 0) || (entry!.tick as number) < previous) fail(`input ${index} is out of order`);
    previous = entry!.tick as number;
  }
  if (!LOOKS.includes(state.look as SpectralLookName)) fail(`unknown look ${String(state.look)}`);
  const camera = state.camera as Record<string, unknown> | null;
  if (!camera || !isVec3(camera.position) || !isVec3(camera.target) || typeof camera.fovDegrees !== 'number') fail('camera is malformed');
  if (typeof state.hash !== 'string' || !/^[0-9a-f]{8}$/.test(state.hash)) fail('hash is malformed');
  return state as unknown as HomeStateV1;
}

/** Restores a saved state by replay; throws when the replayed signature differs from the saved hash. */
export function restoreHomeState(model: GraphNcaModel, value: unknown): { world: HomeWorld; state: HomeStateV1 } {
  const state = parseHomeState(value);
  const running = modelFingerprint(model);
  if (state.model !== running) throw new HomeStateError(`home state: saved with model ${state.model}, running ${running}`);
  const preset = HOME_PRESETS[state.presetId as keyof typeof HOME_PRESETS];
  const world = replayHomeWorld(model, preset, state.seed, state.inputs, state.tick);
  const hash = world.signature();
  if (hash !== state.hash) throw new HomeStateError(`home state: replay hash ${hash} does not match saved ${state.hash}`);
  return { world, state };
}
