import type { LoadedCheckpoint } from './checkpoint/types';
import type { WebGlNcaAtlasLayout } from './webgl2Layout';

export interface PackedFloatTexture {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

export interface VectorNcaWeightTextures {
  readonly hiddenWeights: PackedFloatTexture;
  readonly hiddenBias: PackedFloatTexture;
  readonly outputWeights: PackedFloatTexture;
  readonly outputBias: PackedFloatTexture;
}

export function packFloatTexture(
  values: Float32Array,
  maxTextureSize = 16_384,
): PackedFloatTexture {
  if (!Number.isInteger(maxTextureSize) || maxTextureSize <= 0) {
    throw new RangeError('maxTextureSize must be a positive integer');
  }
  const texels = Math.max(1, Math.ceil(values.length / 4));
  const width = Math.min(texels, maxTextureSize);
  const height = Math.ceil(texels / width);
  if (height > maxTextureSize) {
    throw new RangeError(
      `weight payload needs ${width}×${height} texels, exceeding max texture size ${maxTextureSize}`,
    );
  }
  const data = new Float32Array(width * height * 4);
  data.set(values);
  return { width, height, data };
}

export function packVectorNcaWeights(
  checkpoint: LoadedCheckpoint,
  maxTextureSize = 16_384,
): VectorNcaWeightTextures {
  const tensor = (name: string): Float32Array => {
    const value = checkpoint.tensors[name]?.data;
    if (!value) throw new Error(`webgl2 nca: missing tensor ${name}`);
    return value;
  };
  return {
    hiddenWeights: packFloatTexture(tensor('net.0.weight'), maxTextureSize),
    hiddenBias: packFloatTexture(tensor('net.0.bias'), maxTextureSize),
    outputWeights: packFloatTexture(tensor('net.2.weight'), maxTextureSize),
    outputBias: packFloatTexture(tensor('net.2.bias'), maxTextureSize),
  };
}

function scalarFetcher(name: string, uniformName: string, width: number): string {
  return `
float ${name}(int index) {
  int texelIndex = index / 4;
  int lane = index - texelIndex * 4;
  ivec2 coord = ivec2(texelIndex % ${width}, texelIndex / ${width});
  vec4 value = texelFetch(${uniformName}, coord, 0);
  if (lane == 0) return value.r;
  if (lane == 1) return value.g;
  if (lane == 2) return value.b;
  return value.a;
}
`;
}

export function buildVectorNcaMlpFragmentShader(
  checkpoint: LoadedCheckpoint,
  layout: WebGlNcaAtlasLayout,
  weights: VectorNcaWeightTextures,
): string {
  if (checkpoint.architecture !== 'vector_nca_mlp_v1') {
    throw new Error(`webgl2 nca: cannot build shader for ${checkpoint.architecture}`);
  }

  const latent = checkpoint.latentChannels;
  const sensors = checkpoint.sensorChannels;
  const hidden = checkpoint.hiddenWidth;
  const inputWidth = latent * 2 + sensors;
  const updateRate = Number(checkpoint.updateRate).toPrecision(9);

  return `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D sourceState;
uniform sampler2D sensorState;
uniform sampler2D hiddenWeights;
uniform sampler2D hiddenBias;
uniform sampler2D outputWeights;
uniform sampler2D outputBias;
out vec4 outState;

const int NODE_COUNT = ${layout.nodeCount};
const int NODES_PER_ROW = ${layout.nodesPerRow};
const int STATE_BLOCKS = ${layout.stateBlocks};
const int SENSOR_BLOCKS = ${Math.max(1, layout.sensorBlocks)};
const int LATENT_CHANNELS = ${latent};
const int SENSOR_CHANNELS = ${sensors};
const int HIDDEN_WIDTH = ${hidden};
const int INPUT_WIDTH = ${inputWidth};
const float UPDATE_RATE = ${updateRate};

float componentAt(vec4 value, int lane) {
  if (lane == 0) return value.r;
  if (lane == 1) return value.g;
  if (lane == 2) return value.b;
  return value.a;
}

float stateChannel(int node, int channel) {
  int row = node / NODES_PER_ROW;
  int column = node - row * NODES_PER_ROW;
  int block = channel / 4;
  int lane = channel - block * 4;
  vec4 value = texelFetch(sourceState, ivec2(column * STATE_BLOCKS + block, row), 0);
  return componentAt(value, lane);
}

float sensorChannel(int node, int channel) {
  int row = node / NODES_PER_ROW;
  int column = node - row * NODES_PER_ROW;
  int block = channel / 4;
  int lane = channel - block * 4;
  vec4 value = texelFetch(sensorState, ivec2(column * SENSOR_BLOCKS + block, row), 0);
  return componentAt(value, lane);
}
${scalarFetcher('hiddenWeightAt', 'hiddenWeights', weights.hiddenWeights.width)}
${scalarFetcher('hiddenBiasAt', 'hiddenBias', weights.hiddenBias.width)}
${scalarFetcher('outputWeightAt', 'outputWeights', weights.outputWeights.width)}
${scalarFetcher('outputBiasAt', 'outputBias', weights.outputBias.width)}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  int row = pixel.y;
  int block = pixel.x % STATE_BLOCKS;
  int column = pixel.x / STATE_BLOCKS;
  int node = row * NODES_PER_ROW + column;

  if (node >= NODE_COUNT) {
    outState = vec4(0.0);
    return;
  }

  int neighbor = node == 0 ? NODE_COUNT - 1 : node - 1;
  float inputs[INPUT_WIDTH];
  for (int channel = 0; channel < LATENT_CHANNELS; channel++) {
    inputs[channel] = stateChannel(node, channel);
    inputs[LATENT_CHANNELS + channel] = stateChannel(neighbor, channel);
  }
  for (int channel = 0; channel < SENSOR_CHANNELS; channel++) {
    inputs[LATENT_CHANNELS * 2 + channel] = sensorChannel(node, channel);
  }

  float hiddenState[HIDDEN_WIDTH];
  for (int unit = 0; unit < HIDDEN_WIDTH; unit++) {
    float total = hiddenBiasAt(unit);
    int weightOffset = unit * INPUT_WIDTH;
    for (int inputIndex = 0; inputIndex < INPUT_WIDTH; inputIndex++) {
      total += hiddenWeightAt(weightOffset + inputIndex) * inputs[inputIndex];
    }
    hiddenState[unit] = tanh(total);
  }

  vec4 nextState = vec4(0.0);
  for (int lane = 0; lane < 4; lane++) {
    int channel = block * 4 + lane;
    if (channel < LATENT_CHANNELS) {
      float total = outputBiasAt(channel);
      int weightOffset = channel * HIDDEN_WIDTH;
      for (int unit = 0; unit < HIDDEN_WIDTH; unit++) {
        total += outputWeightAt(weightOffset + unit) * hiddenState[unit];
      }
      nextState[lane] = stateChannel(node, channel) + tanh(total) * UPDATE_RATE;
    }
  }

  outState = nextState;
}
`;
}
