import { describe, expect, it } from 'vitest';
import { topologyOverlayVisible } from '../src/rendering/presentationPolicy';

describe('presentation topology policy', () => {
  it('exposes persistent topology only in Technical Wire', () => {
    expect(topologyOverlayVisible('technical')).toBe(true);
    expect(topologyOverlayVisible('porcelain')).toBe(false);
    expect(topologyOverlayVisible('ghost')).toBe(false);
  });
});
