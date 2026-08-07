import { describe, expect, it } from 'vitest';
import { describeOutputCapture, OUTPUT_COLOR_CONTRACT } from '../src/export/colorContract';
import { SPECTRAL_LOOKS } from '../src/spectral/looks';

describe('live and capture color contract', () => {
  it('encodes only once at the final boundary', () => {
    expect(OUTPUT_COLOR_CONTRACT.workingSpace).toBe('Linear sRGB');
    expect(OUTPUT_COLOR_CONTRACT.outputTransfer).toBe('sRGB');
    expect(OUTPUT_COLOR_CONTRACT.outputEncodes).toBe(1);
  });

  it('describes PNG and video sampling from the post-tonemapped canvas', () => {
    for (const look of Object.values(SPECTRAL_LOOKS)) {
      const descriptor = describeOutputCapture(look);
      expect(descriptor.source).toBe('post-tone-mapped-canvas');
      expect(descriptor.look).toBe(look.name);
      expect(descriptor.exposure).toBe(look.exposure);
      expect(descriptor.outputSaturation).toBe(look.outputSaturation);
    }
  });
});
