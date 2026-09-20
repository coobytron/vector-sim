import { describe, expect, it } from 'vitest';
import fixture from '../src/nca/models/p06a-reference-checkpoint.json';
import {
  buildVectorNcaMlpFragmentShader,
  createWebGlNcaAtlasLayout,
  loadBrowserCheckpoint,
  packFloatTexture,
  packVectorNcaWeights,
} from '../src/nca';
import type { BrowserCheckpointContainer } from '../src/nca';

const checkpoint = loadBrowserCheckpoint(fixture as unknown as BrowserCheckpointContainer);

describe('WebGL2 NCA weight textures and shader', () => {
  it('packs float arrays into RGBA textures without changing values', () => {
    const values = Float32Array.from({ length: 11 }, (_unused, index) => index + 0.125);
    const packed = packFloatTexture(values, 2);
    expect(packed.width).toBe(2);
    expect(packed.height).toBe(2);
    expect(Array.from(packed.data.slice(0, values.length))).toEqual(Array.from(values));
  });

  it('packs all four checkpoint tensors', () => {
    const weights = packVectorNcaWeights(checkpoint);
    expect(weights.hiddenWeights.data.length).toBeGreaterThan(
      checkpoint.tensors['net.0.weight']?.data.length ?? 0,
    );
    expect(weights.outputWeights.data.length).toBeGreaterThanOrEqual(
      checkpoint.tensors['net.2.weight']?.data.length ?? 0,
    );
  });

  it('generates the manifest-sized vector_nca_mlp_v1 forward pass', () => {
    const layout = createWebGlNcaAtlasLayout(checkpoint, 32);
    const weights = packVectorNcaWeights(checkpoint);
    const shader = buildVectorNcaMlpFragmentShader(checkpoint, layout, weights);

    expect(shader).toContain('const int LATENT_CHANNELS = 16;');
    expect(shader).toContain('const int SENSOR_CHANNELS = 6;');
    expect(shader).toContain('const int HIDDEN_WIDTH = 64;');
    expect(shader).toContain('const int INPUT_WIDTH = 38;');
    expect(shader).toContain('hiddenState[unit] = tanh(total);');
    expect(shader).toContain('nextState[lane] = stateChannel(node, channel) + tanh(total) * UPDATE_RATE;');
    expect(shader).toContain('int neighbor = node == 0 ? NODE_COUNT - 1 : node - 1;');
  });
});
