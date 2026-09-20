import type { LoadedCheckpoint } from './checkpoint/types';

export interface WebGlNcaAtlasLayout {
  readonly nodeCount: number;
  readonly nodesPerRow: number;
  readonly rows: number;
  readonly latentChannels: number;
  readonly sensorChannels: number;
  readonly stateBlocks: number;
  readonly sensorBlocks: number;
  readonly stateTextureWidth: number;
  readonly stateTextureHeight: number;
  readonly sensorTextureWidth: number;
  readonly sensorTextureHeight: number;
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
}

export function createWebGlNcaAtlasLayout(
  checkpoint: LoadedCheckpoint,
  nodeCount: number,
  maxTextureSize = 16_384,
): WebGlNcaAtlasLayout {
  positiveInteger(nodeCount, 'nodeCount');
  positiveInteger(maxTextureSize, 'maxTextureSize');

  const stateBlocks = Math.ceil(checkpoint.latentChannels / 4);
  const sensorBlocks = Math.ceil(checkpoint.sensorChannels / 4);
  const widestNode = Math.max(1, stateBlocks, sensorBlocks);
  const maxNodesPerRow = Math.floor(maxTextureSize / widestNode);
  if (maxNodesPerRow < 1) {
    throw new RangeError(
      `checkpoint needs ${widestNode} RGBA blocks per node, exceeding max texture width ${maxTextureSize}`,
    );
  }

  const nodesPerRow = Math.min(Math.ceil(Math.sqrt(nodeCount)), maxNodesPerRow);
  const rows = Math.ceil(nodeCount / nodesPerRow);
  if (rows > maxTextureSize) {
    throw new RangeError(
      `nodeCount ${nodeCount} needs ${rows} rows, exceeding max texture height ${maxTextureSize}`,
    );
  }

  return {
    nodeCount,
    nodesPerRow,
    rows,
    latentChannels: checkpoint.latentChannels,
    sensorChannels: checkpoint.sensorChannels,
    stateBlocks,
    sensorBlocks,
    stateTextureWidth: nodesPerRow * stateBlocks,
    stateTextureHeight: rows,
    sensorTextureWidth: nodesPerRow * Math.max(1, sensorBlocks),
    sensorTextureHeight: rows,
  };
}

export function atlasTexel(
  layout: WebGlNcaAtlasLayout,
  node: number,
  block: number,
  kind: 'state' | 'sensor',
): readonly [number, number] {
  if (!Number.isInteger(node) || node < 0 || node >= layout.nodeCount) {
    throw new RangeError(`node ${node} is outside [0, ${layout.nodeCount})`);
  }
  const blocks = kind === 'state' ? layout.stateBlocks : layout.sensorBlocks;
  if (!Number.isInteger(block) || block < 0 || block >= blocks) {
    throw new RangeError(`${kind} block ${block} is outside [0, ${blocks})`);
  }
  return [
    (node % layout.nodesPerRow) * blocks + block,
    Math.floor(node / layout.nodesPerRow),
  ];
}

export function packNodeChannels(
  values: Float32Array,
  channels: number,
  layout: WebGlNcaAtlasLayout,
  kind: 'state' | 'sensor',
): Float32Array {
  const blocks = kind === 'state' ? layout.stateBlocks : layout.sensorBlocks;
  const width = kind === 'state' ? layout.stateTextureWidth : layout.sensorTextureWidth;
  const height = kind === 'state' ? layout.stateTextureHeight : layout.sensorTextureHeight;
  if (channels <= 0 || blocks <= 0) {
    if (values.length !== 0) throw new RangeError(`${kind} values must be empty when channels are zero`);
    return new Float32Array(width * height * 4);
  }
  const expected = layout.nodeCount * channels;
  if (values.length !== expected) {
    throw new RangeError(`${kind} values length ${values.length} does not match ${expected}`);
  }

  const packed = new Float32Array(width * height * 4);
  for (let node = 0; node < layout.nodeCount; node += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const block = Math.floor(channel / 4);
      const lane = channel % 4;
      const [x, y] = atlasTexel(layout, node, block, kind);
      packed[(y * width + x) * 4 + lane] = values[node * channels + channel] ?? 0;
    }
  }
  return packed;
}
