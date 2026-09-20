import { describe, expect, it } from 'vitest';
import { HOME_PRESETS } from '../src/environments/homePresets';
import {
  resolveHomeRoute,
  writeHomeRoute,
} from '../src/environments/homeRoute';

describe('Spectral Homestead route state', () => {
  it('defaults to the Courtyard House establishing camera', () => {
    const route = resolveHomeRoute('');
    expect(route.preset.id).toBe('courtyard-house');
    expect(route.camera.role).toBe('establishing');
  });

  it('resolves every authored preset and camera role deterministically', () => {
    for (const preset of Object.values(HOME_PRESETS)) {
      for (const camera of preset.cameras) {
        const route = resolveHomeRoute(
          `homePreset=${preset.id}&homeCamera=${camera.role}`,
        );
        expect(route.preset).toBe(preset);
        expect(route.camera).toBe(camera);
      }
    }
  });

  it('falls back safely for unknown route values', () => {
    const route = resolveHomeRoute('homePreset=nope&homeCamera=nope');
    expect(route.preset.id).toBe('courtyard-house');
    expect(route.camera.role).toBe('establishing');
  });

  it('round-trips compact Home route state without disturbing other params', () => {
    const preset = HOME_PRESETS['tabletop-habitat'];
    const camera = preset.cameras.find((candidate) => candidate.role === 'macro');
    if (!camera) throw new Error('fixture camera missing');

    const written = writeHomeRoute(
      new URLSearchParams('look=ghost&quality=mobile'),
      preset,
      camera,
    );
    const resolved = resolveHomeRoute(written);

    expect(written.get('look')).toBe('ghost');
    expect(written.get('quality')).toBe('mobile');
    expect(resolved.preset.id).toBe('tabletop-habitat');
    expect(resolved.camera.role).toBe('macro');
  });
});
