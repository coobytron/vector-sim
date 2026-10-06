import { counterRandom } from '../../simulation/prng';

/**
 * CPU reference runtime for the M1 graph NCA (`vector_graph_nca_v1`).
 *
 * Mirrors `training/vector_nca/graph_nca.py` with plain loops over JSON weights:
 *
 *   pre = alive(s)
 *   s += mask · (w2 · relu(w1 · perceive(s) + b1))
 *   s *= pre & alive(s)
 *
 * perceive = [self, mean(neighbours) − self, parent − self, mean(children) − self, sensors],
 * alive(s)[n] = max(s[m][ALIVE] for m in {n} ∪ neighbours(n)) > aliveThreshold, and
 * mask[n] = counterRandom(fireSeed, 0, n, tick, fireStream) < fireRate.
 */

export const GRAPH_NCA_FORMAT = 'vector-sim.graph-nca.v1';
export const GRAPH_NCA_ARCHITECTURE = 'vector_graph_nca_v1';
export const NO_PARENT = -1;
export const ALIVE_CHANNEL = 0;
export const THICKNESS_CHANNEL = 1;
export const TIP_CHANNEL = 2;
const HIDDEN_START = 3;

interface TensorJson {
  readonly shape: readonly number[];
  readonly data: readonly number[];
}

export interface GraphNcaWeightsJson {
  readonly format: string;
  readonly architecture: string;
  readonly phenotype: string;
  readonly channels: number;
  readonly sensor_channels: number;
  readonly hidden_width: number;
  readonly fire_rate: number;
  readonly alive_threshold: number;
  readonly neutral_sensors: readonly number[];
  readonly topology: { readonly slots: number; readonly parents: readonly number[] };
  readonly tensors: { readonly w1: TensorJson; readonly b1: TensorJson; readonly w2: TensorJson };
  readonly golden?: {
    readonly fire_seed: number;
    readonly fire_stream: number;
    readonly frames: readonly { readonly tick: number; readonly sha256_f32le: string; readonly state: readonly number[] }[];
  };
  readonly provenance?: Record<string, unknown>;
}

export class GraphNcaModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphNcaModelError';
  }
}

export interface GraphNcaModel {
  readonly phenotype: string;
  readonly channels: number;
  readonly sensorChannels: number;
  readonly hiddenWidth: number;
  readonly fireRate: number;
  readonly aliveThreshold: number;
  readonly neutralSensors: Float32Array;
  readonly nodes: number;
  readonly parents: Int32Array;
  /** Tree neighbours per node (parent first, then children ascending). */
  readonly neighbors: readonly Int32Array[];
  readonly children: readonly Int32Array[];
  readonly w1: Float32Array;
  readonly b1: Float32Array;
  readonly w2: Float32Array;
}

function tensor(name: string, value: TensorJson | undefined, shape: readonly number[]): Float32Array {
  if (!value || value.shape.length !== shape.length || value.shape.some((size, axis) => size !== shape[axis])) {
    throw new GraphNcaModelError(`tensor ${name} must have shape [${shape.join(', ')}]`);
  }
  const expected = shape.reduce((product, size) => product * size, 1);
  if (value.data.length !== expected) {
    throw new GraphNcaModelError(`tensor ${name} has ${value.data.length} values, expected ${expected}`);
  }
  const data = Float32Array.from(value.data);
  if (!data.every(Number.isFinite)) throw new GraphNcaModelError(`tensor ${name} contains non-finite values`);
  return data;
}

export function loadGraphNcaModel(json: GraphNcaWeightsJson): GraphNcaModel {
  if (json.format !== GRAPH_NCA_FORMAT) throw new GraphNcaModelError(`unsupported format ${json.format}`);
  if (json.architecture !== GRAPH_NCA_ARCHITECTURE) {
    throw new GraphNcaModelError(`unsupported architecture ${json.architecture}`);
  }
  const channels = json.channels;
  const sensorChannels = json.sensor_channels;
  const hiddenWidth = json.hidden_width;
  if (json.neutral_sensors.length !== sensorChannels) {
    throw new GraphNcaModelError('neutral_sensors length must equal sensor_channels');
  }
  const parents = Int32Array.from(json.topology.parents);
  const nodes = parents.length;
  if (nodes !== json.topology.slots) throw new GraphNcaModelError('topology.parents length must equal slots');

  const neighborLists: number[][] = Array.from({ length: nodes }, () => []);
  const childLists: number[][] = Array.from({ length: nodes }, () => []);
  parents.forEach((parent, node) => {
    if (parent === NO_PARENT) return;
    if (parent < 0 || parent >= node) throw new GraphNcaModelError('parents must precede children');
    neighborLists[node]!.push(parent);
    neighborLists[parent]!.push(node);
    childLists[parent]!.push(node);
  });

  const inputs = channels * 4 + sensorChannels;
  return {
    phenotype: json.phenotype,
    channels,
    sensorChannels,
    hiddenWidth,
    fireRate: json.fire_rate,
    aliveThreshold: json.alive_threshold,
    neutralSensors: Float32Array.from(json.neutral_sensors),
    nodes,
    parents,
    neighbors: neighborLists.map((list) => Int32Array.from(list)),
    children: childLists.map((list) => Int32Array.from(list)),
    w1: tensor('w1', json.tensors.w1, [hiddenWidth, inputs]),
    b1: tensor('b1', json.tensors.b1, [hiddenWidth]),
    w2: tensor('w2', json.tensors.w2, [channels, hiddenWidth]),
  };
}

/** Growing-NCA seed: one live node with alive and hidden channels at 1. */
export function graphNcaSeedState(model: GraphNcaModel, root = 0): Float32Array {
  const state = new Float32Array(model.nodes * model.channels);
  const base = root * model.channels;
  state[base + ALIVE_CHANNEL] = 1;
  for (let channel = HIDDEN_START; channel < model.channels; channel += 1) state[base + channel] = 1;
  return state;
}

/** `nodes × sensorChannels` filled with the model's neutral sensor vector. */
export function graphNcaNeutralSensors(model: GraphNcaModel): Float32Array {
  const sensors = new Float32Array(model.nodes * model.sensorChannels);
  for (let node = 0; node < model.nodes; node += 1) {
    sensors.set(model.neutralSensors, node * model.sensorChannels);
  }
  return sensors;
}

function aliveMask(model: GraphNcaModel, state: Float32Array, out: Uint8Array): void {
  const { channels, aliveThreshold } = model;
  for (let node = 0; node < model.nodes; node += 1) {
    let pooled = state[node * channels + ALIVE_CHANNEL]!;
    for (const other of model.neighbors[node]!) pooled = Math.max(pooled, state[other * channels + ALIVE_CHANNEL]!);
    out[node] = pooled > aliveThreshold ? 1 : 0;
  }
}

export interface GraphNcaStepper {
  /** Advances `state` in place by one tick. */
  step(state: Float32Array, sensors: Float32Array, tick: number): void;
}

export function createGraphNcaStepper(model: GraphNcaModel, fireSeed: number, fireStream: number): GraphNcaStepper {
  const { nodes, channels, sensorChannels, hiddenWidth, w1, b1, w2 } = model;
  const inputs = channels * 4 + sensorChannels;
  const perception = new Float32Array(inputs);
  const hidden = new Float32Array(hiddenWidth);
  const delta = new Float32Array(nodes * channels);
  const pre = new Uint8Array(nodes);
  const post = new Uint8Array(nodes);

  return {
    step(state, sensors, tick) {
      if (state.length !== nodes * channels) throw new GraphNcaModelError('state has the wrong length');
      if (sensors.length !== nodes * sensorChannels) throw new GraphNcaModelError('sensors have the wrong length');
      aliveMask(model, state, pre);
      delta.fill(0);
      for (let node = 0; node < nodes; node += 1) {
        if (counterRandom(fireSeed, 0, node, tick, fireStream) >= model.fireRate) continue;
        const base = node * channels;
        const neighbors = model.neighbors[node]!;
        const children = model.children[node]!;
        const parent = model.parents[node]!;
        for (let channel = 0; channel < channels; channel += 1) {
          const self = state[base + channel]!;
          let neighborSum = 0;
          for (const other of neighbors) neighborSum += state[other * channels + channel]!;
          let childSum = 0;
          for (const child of children) childSum += state[child * channels + channel]!;
          perception[channel] = self;
          perception[channels + channel] = neighbors.length ? neighborSum / neighbors.length - self : -self;
          perception[channels * 2 + channel] = parent === NO_PARENT ? 0 : state[parent * channels + channel]! - self;
          perception[channels * 3 + channel] = children.length ? childSum / children.length - self : 0;
        }
        for (let sensor = 0; sensor < sensorChannels; sensor += 1) {
          perception[channels * 4 + sensor] = sensors[node * sensorChannels + sensor]!;
        }
        for (let unit = 0; unit < hiddenWidth; unit += 1) {
          let sum = b1[unit]!;
          const row = unit * inputs;
          for (let input = 0; input < inputs; input += 1) sum += w1[row + input]! * perception[input]!;
          hidden[unit] = sum > 0 ? sum : 0;
        }
        for (let channel = 0; channel < channels; channel += 1) {
          let sum = 0;
          const row = channel * hiddenWidth;
          for (let unit = 0; unit < hiddenWidth; unit += 1) sum += w2[row + unit]! * hidden[unit]!;
          delta[base + channel] = sum;
        }
      }
      for (let index = 0; index < state.length; index += 1) state[index]! += delta[index]!;
      aliveMask(model, state, post);
      for (let node = 0; node < nodes; node += 1) {
        if (pre[node] && post[node]) continue;
        state.fill(0, node * channels, (node + 1) * channels);
      }
    },
  };
}
