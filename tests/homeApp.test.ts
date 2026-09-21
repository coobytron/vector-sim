import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/createApp';
import { HOME_PRESETS } from '../src/environments/homePresets';
import { VectorRenderer } from '../src/rendering/vectorRenderer';
import { HeadlessSimulation } from '../src/simulation/headlessSimulation';
import type { SimulationConfig } from '../src/simulation/types';
import type * as CapabilitiesModule from '../src/platform/capabilities';
import { createShell, type ShellElements } from '../src/ui/shell';

vi.mock('../src/ui/shell', () => ({ createShell: vi.fn(), showFallback: vi.fn() }));
vi.mock('../src/platform/capabilities', async (importOriginal) => ({
  ...await importOriginal<typeof CapabilitiesModule>(),
  detectCapabilities: () => ({ webgl2: true, webgpu: false, coarsePointer: false }),
}));
vi.mock('../src/simulation/headlessSimulation', async (importOriginal) => {
  const actual = await importOriginal<{ HeadlessSimulation: typeof HeadlessSimulation }>();
  return {
    HeadlessSimulation: vi.fn(function (config: SimulationConfig) {
      return new actual.HeadlessSimulation(config);
    }),
  };
});
vi.mock('../src/rendering/vectorRenderer', () => ({
  VectorRenderer: vi.fn(class {
    setHomeCamera = vi.fn();
    setLook = vi.fn();
    recenter = vi.fn();
    dispose = vi.fn();
  }),
}));

class Control extends EventTarget {
  value = '';
  textContent = '';
}

describe('Home app route integration', () => {
  let location: { href: string; search: string; assign: ReturnType<typeof vi.fn> };
  let shell: ShellElements;

  function start(query: string) {
    const url = new URL(`http://localhost/${query}`);
    location.href = url.href;
    location.search = url.search;
    return createApp({} as HTMLElement);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    location = { href: '', search: '', assign: vi.fn() };
    vi.stubGlobal('window', {
      location,
      history: { replaceState: vi.fn((_state, _unused, url: URL) => {
        location.href = url.href;
        location.search = url.search;
      }) },
    });
    vi.stubGlobal('document', new EventTarget());
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    shell = Object.fromEntries([
      'canvas', 'frame', 'status', 'performance', 'pauseButton', 'recenterButton',
      'captureButton', 'qualitySelect', 'lookSelect', 'homePresetSelect', 'homeCameraSelect',
      'fallback',
    ].map((name) => [name, new Control()])) as unknown as ShellElements;
    vi.mocked(createShell).mockReturnValue(shell);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('passes the selected manifest and camera to the shell and renderer and uses its seed', () => {
    const app = start('?homePreset=domestic-section&homeCamera=top-down&tick=12');
    const options = vi.mocked(VectorRenderer).mock.calls[0]![3];
    expect(options.homePreset).toBe(HOME_PRESETS['domestic-section']);
    expect(options.homeCamera?.role).toBe('top-down');
    expect(vi.mocked(createShell).mock.calls[0]![7]?.preset).toBe(options.homePreset);
    expect(vi.mocked(createShell).mock.calls[0]![7]?.camera).toBe(options.homeCamera);
    expect(vi.mocked(HeadlessSimulation).mock.calls[0]![0].seed).toBe(4102);
    expect(vi.mocked(HeadlessSimulation).mock.calls[0]![0].fieldProvider?.manifest.id).toBe('spectral-home/domestic-section');
    expect(vi.mocked(HeadlessSimulation).mock.results[0]!.value.tick).toBe(12);
    expect(vi.mocked(VectorRenderer).mock.calls[0]![2].lifecycle?.presentations.size).toBe(8);
    expect(shell.pauseButton.textContent).toBe('Resume');
    app.dispose();
  });

  it('switches camera without rebuilding the simulation and preserves the shareable route', () => {
    const app = start('?homePreset=tabletop-habitat&look=ghost&quality=mobile&seed=7&tick=12');
    shell.homeCameraSelect!.value = 'macro';
    shell.homeCameraSelect!.dispatchEvent(new Event('change'));
    const renderer = vi.mocked(VectorRenderer).mock.results[0]!.value;
    expect(renderer.setHomeCamera).toHaveBeenCalledWith(
      HOME_PRESETS['tabletop-habitat'].cameras.find((camera) => camera.role === 'macro'),
    );
    expect(HeadlessSimulation).toHaveBeenCalledTimes(1);
    expect(vi.mocked(HeadlessSimulation).mock.calls[0]![0].seed).toBe(7);
    const params = new URL(location.href).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      homePreset: 'tabletop-habitat', homeCamera: 'macro', look: 'ghost',
      quality: 'mobile', seed: '7', tick: '12',
    });
    expect(location.assign).not.toHaveBeenCalled();
    expect(shell.status.textContent).toContain('macro');
    shell.recenterButton.dispatchEvent(new Event('click'));
    expect(renderer.recenter).toHaveBeenCalledOnce();
    app.dispose();
  });

  it('reloads a newly selected preset while retaining the selected camera and other options', () => {
    const app = start('?homePreset=courtyard-house&homeCamera=macro&look=technical&quality=mobile&tick=180');
    shell.homePresetSelect!.value = 'domestic-section';
    shell.homePresetSelect!.dispatchEvent(new Event('change'));
    const url = location.assign.mock.calls[0]![0] as URL;
    expect(Object.fromEntries(url.searchParams)).toEqual({
      homePreset: 'domestic-section', homeCamera: 'macro', look: 'technical',
      quality: 'mobile', tick: '180',
    });
    app.dispose();
  });

  it('keeps Home route parameters out of Organism Lab rendering and seed selection', () => {
    const app = start('?organisms=1&homePreset=tabletop-habitat&homeCamera=macro&tick=0');
    expect(vi.mocked(VectorRenderer).mock.calls[0]![3].homePreset).toBeUndefined();
    expect(vi.mocked(HeadlessSimulation).mock.calls[0]![0].seed).toBe(0x5350_4543);
    expect(vi.mocked(HeadlessSimulation).mock.calls[0]![0].fieldProvider).toBeUndefined();
    expect(vi.mocked(VectorRenderer).mock.calls[0]![2].lifecycle).toBeUndefined();
    app.dispose();
  });
});
