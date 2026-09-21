import {
  BrowserBenchmarkSession,
  parseBenchmarkDurationSeconds,
} from '../benchmark/browserBenchmark';
import { runGpuMicrobenchmarks } from '../benchmark/gpuMicrobenchmarks';
import {
  parseCaptureDistance,
  parseCaptureState,
  parseCaptureTick,
  parseNcaMode,
  parseRunSeed,
} from '../organisms/captureRoute';
import { runP06BrowserParity } from '../nca/browserParityReceipt';
import { detectCapabilities, selectQualityTier } from '../platform/capabilities';
import { VectorRenderer, type RenderMode } from '../rendering/vectorRenderer';
import { FixedStepper } from '../simulation/fixedStepper';
import { HeadlessSimulation } from '../simulation/headlessSimulation';
import { showBenchmarkProgress, showBenchmarkResult } from '../ui/benchmarkPanel';
import { createShell, showFallback } from '../ui/shell';
import { createSpectralPanel } from '../ui/spectralPanel';
import { selectSpectralLook } from '../spectral/looks';
import { resolveHomeRoute, writeHomeRoute } from '../environments/homeRoute';
import { createHomePresetFieldProvider } from '../environments/homePresets';

export interface VectorSimApp {
  dispose(): void;
}

export function createApp(root: HTMLElement): VectorSimApp {
  const parameters = new URLSearchParams(window.location.search);
  const parityRequested = parameters.get('ncaParity') === '1';
  const capabilities = detectCapabilities();
  const tier = selectQualityTier(capabilities, parameters.get('quality'));
  const mode: RenderMode = parameters.get('organisms') === '1'
    ? 'organisms'
    : parameters.get('calibration') === '1'
      ? 'calibration'
      : 'home';
  let look = selectSpectralLook(parameters.get('look'));
  const homeRoute = mode === 'home' ? resolveHomeRoute(parameters) : undefined;
  const seed = parseRunSeed(parameters.get('seed'), homeRoute?.preset.seed);
  const ncaMode = parseNcaMode(parameters.get('nca'));
  const captureTick = mode !== 'calibration' ? parseCaptureTick(parameters.get('tick')) : undefined;
  const captureState = mode === 'organisms' ? parseCaptureState(parameters.get('state')) : undefined;
  const captureDistance = mode === 'organisms'
    ? parseCaptureDistance(parameters.get('distance'))
    : undefined;
  const shell = createShell(
    root,
    tier.name,
    mode,
    look.name,
    captureState,
    captureDistance ?? 'mid',
    ncaMode,
    homeRoute,
  );
  if (parityRequested) {
    if (!capabilities.webgl2) {
      shell.canvas.hidden = true;
      showFallback(
        shell.fallback,
        'WebGL2 parity cannot run.',
        'This browser does not expose WebGL2, so the P06 CPU↔GPU validation receipt cannot be produced.',
      );
      shell.status.textContent = 'P06 parity unavailable';
      shell.performance.textContent = 'WebGL2 unavailable';
      return { dispose: () => undefined };
    }

    const gl = shell.canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      shell.canvas.hidden = true;
      showFallback(
        shell.fallback,
        'WebGL2 context creation failed.',
        'The browser reports WebGL2 support but could not create the validation context.',
      );
      shell.status.textContent = 'P06 parity unavailable';
      shell.performance.textContent = 'WebGL2 context failed';
      return { dispose: () => undefined };
    }

    try {
      const receipt = runP06BrowserParity(gl, {
        steps: Number(parameters.get('paritySteps') ?? 1000),
        tolerance: Number(parameters.get('parityTolerance') ?? 1e-4),
        boundedLimit: Number(parameters.get('parityBound') ?? 1000),
      });
      shell.canvas.hidden = true;
      shell.fallback.hidden = false;
      shell.fallback.replaceChildren();

      const card = document.createElement('div');
      card.className = 'fallback-card';
      const eyebrow = document.createElement('p');
      eyebrow.className = 'eyebrow';
      eyebrow.textContent = 'P06 / CPU↔GPU validation receipt';
      const heading = document.createElement('h2');
      heading.textContent = receipt.pass ? 'Parity PASS' : 'Parity FAIL';
      const summary = document.createElement('p');
      summary.textContent =
        `${receipt.steps} steps · tolerance ${receipt.tolerance} · max error ${receipt.result.comparison.maxAbsoluteError.toExponential(3)} · GPU max |${receipt.result.gpuMaxAbs.toFixed(3)}|`;
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(receipt, null, 2);
      card.append(eyebrow, heading, summary, pre);
      shell.fallback.append(card);
      shell.status.textContent = receipt.pass ? 'P06 parity PASS' : 'P06 parity FAIL';
      shell.performance.textContent =
        `${receipt.result.telemetry.steps} GPU steps · ${receipt.result.telemetry.maxStepMs.toFixed(2)} ms max step`;
    } catch (error) {
      shell.canvas.hidden = true;
      showFallback(
        shell.fallback,
        'P06 parity run failed.',
        error instanceof Error ? error.message : String(error),
      );
      shell.status.textContent = 'P06 parity error';
      shell.performance.textContent = 'Validation failed before receipt';
    }
    return { dispose: () => undefined };
  }

  const simulation = new HeadlessSimulation({
    tier, seed, ncaMode,
    fieldProvider: homeRoute ? createHomePresetFieldProvider(homeRoute.preset) : undefined,
  });
  if (captureTick !== undefined) {
    for (let tick = 0; tick < captureTick; tick += 1) simulation.step();
  }
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

  const renderer = new VectorRenderer(shell.canvas, tier, simulation.snapshot, {
    mode,
    look,
    captureState,
    captureDistance,
    homePreset: homeRoute?.preset,
    homeCamera: homeRoute?.camera,
  });
  const stepper = new FixedStepper(1 / 30, 4);
  const benchmark = benchmarkRequested
    ? new BrowserBenchmarkSession(tier, capabilities, 2_000, benchmarkSeconds * 1_000)
    : undefined;
  const benchmarkPanel = benchmarkRequested
    ? showBenchmarkProgress(shell.frame, benchmarkSeconds + 2)
    : undefined;
  let animationFrame = 0;
  let paused = captureTick !== undefined;
  let disposed = false;
  let frameCounter = 0;
  let readoutStart = performance.now();
  const spectralPanel = mode === 'calibration' && !benchmarkRequested
    ? createSpectralPanel(
        shell.frame,
        look,
        (sample) => renderer.setSpectralProbe(sample),
        (exposure) => renderer.setExposure(exposure),
      )
    : undefined;

  if (paused) shell.pauseButton.textContent = 'Resume';
  let captureStatus = mode === 'organisms'
    ? ` · ${captureState ?? 'live state'} · seed ${seed} · ${ncaMode} NCA`
    : mode === 'home' && homeRoute
      ? ` · ${homeRoute.preset.displayName} · ${homeRoute.camera.role} · seed ${seed}`
      : '';
  shell.status.textContent = `${tier.name} · ${look.label}${captureStatus} · ${capabilities.webgpu ? 'WebGPU available' : 'WebGL2'}`;
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
    shell.status.textContent = `${tier.name} · ${look.label}${captureStatus} · ${capabilities.webgpu ? 'WebGPU available' : 'WebGL2'}`;
  });
  shell.stateSelect?.addEventListener('change', () => {
    const url = new URL(window.location.href);
    if (shell.stateSelect?.value) url.searchParams.set('state', shell.stateSelect.value);
    else url.searchParams.delete('state');
    window.location.assign(url);
  });
  shell.distanceSelect?.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('distance', shell.distanceSelect?.value ?? 'mid');
    window.location.assign(url);
  });
  shell.ncaSelect?.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('nca', shell.ncaSelect?.value ?? 'live');
    window.location.assign(url);
  });
  shell.homePresetSelect?.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('homePreset', shell.homePresetSelect?.value ?? 'courtyard-house');
    const route = resolveHomeRoute(url.searchParams);
    url.search = writeHomeRoute(url.searchParams, route.preset, route.camera).toString();
    window.location.assign(url);
  });
  shell.homeCameraSelect?.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('homeCamera', shell.homeCameraSelect?.value ?? 'establishing');
    const route = resolveHomeRoute(url.searchParams);
    renderer.setHomeCamera(route.camera);
    captureStatus = ` · ${route.preset.displayName} · ${route.camera.role} · seed ${seed}`;
    shell.status.textContent = `${tier.name} · ${look.label}${captureStatus} · ${capabilities.webgpu ? 'WebGPU available' : 'WebGL2'}`;
    url.search = writeHomeRoute(url.searchParams, route.preset, route.camera).toString();
    window.history.replaceState({}, '', url);
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
      renderer.dispose();
    },
  };
}
