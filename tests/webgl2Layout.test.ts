import { describe, expect, it } from 'vitest';
import fixture from '../src/nca/models/p06a-reference-checkpoint.json';
import {
  atlasTexel,
  createWebGlNcaAtlasLayout,
  loadBrowserCheckpoint,
  packNodeChannels,
  unpackNodeChannels,
} from '../src/nca';
import type { BrowserCheckpointContainer } from '../src/nca';

const checkpoint = loadBrowserCheckpoint(fixture as unknown as BrowserCheckpointContainer);

describe('WebGL2 NCA atlas layout', () => {
  it('allocates all checkpoint channels instead of truncating state to one RGBA texel', () => {
    const layout = createWebGlNcaAtlasLayout(checkpoint, 32);
    expect(checkpoint.latentChannels).toBe(16);
    expect(layout.stateBlocks).toBe(4);
    expect(layout.sensorBlocks).toBe(2);
    expect(layout.stateTextureWidth).toBe(layout.nodesPerRow * 4);
    expect(layout.sensorTextureWidth).toBe(layout.nodesPerRow * 2);
  });

  it('maps node/channel blocks deterministically across rows', () => {
    const layout = createWebGlNcaAtlasLayout(checkpoint, 32);
    expect(atlasTexel(layout, 0, 0, 'state')).toEqual([0, 0]);
    expect(atlasTexel(layout, 0, 3, 'state')).toEqual([3, 0]);
    expect(atlasTexel(layout, layout.nodesPerRow, 0, 'state')).toEqual([0, 1]);
  });

  it('packs row-major latent channels into RGBA blocks without loss', () => {
    const nodes = 3;
    const layout = createWebGlNcaAtlasLayout(checkpoint, nodes);
    const values = Float32Array.from(
      { length: nodes * checkpoint.latentChannels },
      (_unused, index) => index + 0.25,
    );
    const packed = packNodeChannels(values, checkpoint.latentChannels, layout, 'state');

    for (let node = 0; node < nodes; node += 1) {
      for (let channel = 0; channel < checkpoint.latentChannels; channel += 1) {
        const [x, y] = atlasTexel(layout, node, Math.floor(channel / 4), 'state');
        const actual = packed[(y * layout.stateTextureWidth + x) * 4 + (channel % 4)];
        expect(actual).toBe(values[node * checkpoint.latentChannels + channel]);
      }
    }
  });

  it('round-trips packed latent channels exactly', () => {
    const nodes = 5;
    const layout = createWebGlNcaAtlasLayout(checkpoint, nodes);
    const values = Float32Array.from(
      { length: nodes * checkpoint.latentChannels },
      (_unused, index) => Math.sin(index * 0.17),
    );
    const packed = packNodeChannels(values, checkpoint.latentChannels, layout, 'state');
    expect(Array.from(unpackNodeChannels(
      packed,
      checkpoint.latentChannels,
      layout,
      'state',
    ))).toEqual(Array.from(values));
  });

  it('rejects layouts that exceed the device texture limit', () => {
    expect(() => createWebGlNcaAtlasLayout(checkpoint, 1_000_000, 8)).toThrow(/exceeding/);
  });
});
