import {
  BrowserBenchmarkSession,
  parseBenchmarkDurationSeconds,
} from '../benchmark/browserBenchmark';
import { runGpuMicrobenchmarks } from '../benchmark/gpuMicrobenchmarks';
import { detectCapabilities, selectQualityTier } from '../platform/capabilities';
import { VectorRenderer, type RenderMode } from '../rendering/vectorRenderer';
import { FixedStepper } from '../simulation/fixedStepper';
import { HeadlessSimulation } from '../simulation/headlessSimulation';
import { showBenchmarkProgress, showBenchmarkResult } from '../ui/benchmarkPanel';
import { createShell, showFallback } from '../ui/shell';
import { createSpectralPanel } from '../ui/spectralPanel';
import { createFieldSample } from '../fields/types';
import type { FieldPanelController } from '../ui/fieldPanel';
import { selectEnvironmentManifest } from '../environments/manifests';
import { selectSpectralLook } from '../spectral/looks';

export interface VectorSimApp {
  dispose(): void;
}

export function createApp(root: HTMLElement): VectorSimApp {
  const parameters = new URLSearchParams(window.location.search);
  const capabilities = detectCapabilities();
  const tier = selectQualityTier(capabilities, parameters.get('quality'));
  const mode: RenderMode = parameters.get('calibration') === '1' ? 'calibration' : 'home';
  let look = selectSpectralLook(parameters.get('look'));
  const shell = createShell(root, tier.name, mode, look.name);
  const manifest = selectEnvironmentManifest(parameters.get('environment'));
  const simulation = new HeadlessSimulation({ tier, seed: 0x53504543, manifest });
  const fieldDebugRequested = parameters.get('fields') === '1' && mode === 'home';
  const benchmarkRequested = parameters.get('benchmark') === '1';
  const benchmarkSeconds = parseBenchmarkDurationSeconds(parameters.get('duration'));

  if (!capabilities.webgl2) {
    shell.canvas.hidden = true;
    showFallback(
      shell.fallback,
      'WebGL2 is unavailable.',
      `The deterministic simulation core is healthy at tick ${simulation.tick} (${simulation.stateHash()}), but this browser cannot create the required vector renderer. Update the browser or use a WebGL2-capable device.`,
    );
    shell.status.textContent = 'Headless fallback';
    shell.performance.textContent = `${tier.name} · WebGL2 unavailable`;
    return { dispose: () => undefined };
  }

  const renderer = new VectorRenderer(shell.canvas, tier, simulation.snapshot, { mode, look });
  const stepper = new FixedStepper(1 / 30, 4);
  const benchmark = benchmarkRequested
    ? new BrowserBenchmarkSession(tier, capabilities, 2_000, benchmarkSeconds * 1_000)
    : undefined;
  const benchmarkPanel = benchmarkRequested
    ? showBenchmarkProgress(shell.frame, benchmarkSeconds + 2)
    : undefined;
  let animationFrame = 0;
  let paused = false;
  let disposed = false;
  let frameCounter = 0;
  let readoutStart = performance.now();
  let fieldPanel: FieldPanelController | undefined;
  const fieldProbe = createFieldSample();
  let probeUpdatedAt = 0;

  if (fieldDebugRequested && !benchmarkRequested) {
    // The inspector is a separate chunk: the default run never downloads it.
    void Promise.all([import('../rendering/fieldDebugScene'), import('../ui/fieldPanel')]).then(
      ([{ FieldDebugScene }, { createFieldPanel }]) => {
        if (disposed) return;
        renderer.attachFieldDebug(new FieldDebugScene(simulation.fields, look));
        fieldPanel = createFieldPanel(shell.frame, simulation.fields, () =>
          renderer.rebuildFieldDebug(),
        );
      },
    );
  }
  const spectralPanel = mode === 'calibration' && !benchmarkRequested
    ? createSpectralPanel(
        shell.frame,
        look,
        (sample) => renderer.setSpectralProbe(sample),
        (exposure) => renderer.setExposure(exposure),
      )
    : undefined;

  shell.status.textContent = `${tier.name} · ${look.label} · ${capabilities.webgpu ? 'WebGPU available' : 'WebGL2'}`;
  shell.pauseButton.addEventListener('click', () => {
    paused = !paused;
    shell.pauseButton.textContent = paused ? 'Resume' : 'Pause';
    if (!paused) stepper.reset(performance.now() / 1000);
  });
  shell.recenterButton.addEventListener('click', () => renderer.recenter());
  shell.captureButton.addEventListener('click', () => {
    shell.captureButton.disabled = true;
    shell.captureButton.textContent = 'Saving…';
    renderer.capturePng().finally(() => {
      shell.captureButton.disabled = false;
      shell.captureButton.textContent = 'Save PNG';
    });
  });
  shell.qualitySelect.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('quality', shell.qualitySelect.value);
    window.location.assign(url);
  });
  shell.lookSelect.addEventListener('change', () => {
    look = selectSpectralLook(shell.lookSelect.value);
    renderer.setLook(look);
    spectralPanel?.setLook(look);
    const url = new URL(window.location.href);
    url.searchParams.set('look', look.name);
    window.history.replaceState({}, '', url);
    shell.status.textContent = `${tier.name} · ${look.label} · ${capabilities.webgpu ? 'WebGPU available' : 'WebGL2'}`;
  });

  const onVisibility = (): void => {
    if (document.hidden) {
      stepper.reset();
    } else {
      stepper.reset(performance.now() / 1000);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const frame = (nowMs: number): void => {
    if (disposed) return;
    const frameStart = performance.now();
    const advance = paused
      ? { alpha: 1, droppedSeconds: 0, steps: 0 }
      : stepper.advance(nowMs / 1000, (dt) => simulation.step(dt));
    const metrics = renderer.update(simulation.snapshot, advance.alpha);
    const workMs = performance.now() - frameStart;
    const result = benchmark?.record(
      { nowMs, workMs, steps: advance.steps, renderer: metrics },
      () => simulation.stateHash(),
    );
    if (result && benchmarkPanel) {
      result.gpuProbes = runGpuMicrobenchmarks(tier);
      showBenchmarkResult(benchmarkPanel, result);
    }
    frameCounter += 1;

    if (fieldPanel && nowMs - probeUpdatedAt >= 250) {
      const target = renderer.probeTarget();
      simulation.fields.sample(target[0], target[1], target[2], fieldProbe);
      fieldPanel.refresh(fieldProbe, target);
      probeUpdatedAt = nowMs;
    }

    if (nowMs - readoutStart >= 500) {
      const elapsed = Math.max(1, nowMs - readoutStart);
      const fps = (frameCounter * 1000) / elapsed;
      shell.performance.textContent = `${fps.toFixed(0)} fps · ${workMs.toFixed(1)} ms CPU · ${simulation.tick} ticks · ${metrics.triangles.toLocaleString()} tris`;
      frameCounter = 0;
      readoutStart = nowMs;
    }
    animationFrame = requestAnimationFrame(frame);
  };

  animationFrame = requestAnimationFrame(frame);

  return {
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      document.removeEventListener('visibilitychange', onVisibility);
      spectralPanel?.dispose();
      fieldPanel?.dispose();
      renderer.dispose();
    },
  };
}
