import fixture from './models/p06a-reference-checkpoint.json';
import {
  loadBrowserCheckpoint,
  runWebGlNcaParity,
  type BrowserCheckpointContainer,
  type WebGlNcaParityResult,
} from './index';

export interface BrowserParityReceipt {
  readonly schema: 'vector-sim-p06b-browser-parity-v1';
  readonly timestamp: string;
  readonly userAgent: string;
  readonly platform: string;
  readonly glVendor: string;
  readonly glRenderer: string;
  readonly unmaskedVendor?: string;
  readonly unmaskedRenderer?: string;
  readonly nodeCount: number;
  readonly steps: number;
  readonly tolerance: number;
  readonly boundedLimit: number;
  readonly checkpointVersion: string;
  readonly checkpointSha256: string;
  readonly pass: boolean;
  readonly result: WebGlNcaParityResult;
}

export interface BrowserParityRunOptions {
  readonly nodeCount?: number;
  readonly steps?: number;
  readonly tolerance?: number;
  readonly boundedLimit?: number;
}

function clampInteger(value: number, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export function createBrowserParityInputs(
  nodeCount: number,
  latentChannels: number,
  sensorChannels: number,
): { readonly initialState: Float32Array; readonly sensors: Float32Array } {
  const initialState = new Float32Array(nodeCount * latentChannels);
  const sensors = new Float32Array(nodeCount * sensorChannels);

  for (let node = 0; node < nodeCount; node += 1) {
    for (let channel = 0; channel < latentChannels; channel += 1) {
      const index = node * latentChannels + channel;
      initialState[index] =
        Math.sin((node + 1) * 0.37 + (channel + 1) * 0.19) * 0.08 +
        Math.cos((node + 1) * (channel + 1) * 0.013) * 0.02;
    }
    for (let channel = 0; channel < sensorChannels; channel += 1) {
      const index = node * sensorChannels + channel;
      sensors[index] = Math.sin((node + 1) * 0.11 + channel * 0.41) * 0.5;
    }
  }

  return { initialState, sensors };
}

export function runP06BrowserParity(
  gl: WebGL2RenderingContext,
  options: BrowserParityRunOptions = {},
): BrowserParityReceipt {
  const checkpoint = loadBrowserCheckpoint(
    fixture as unknown as BrowserCheckpointContainer,
  );
  const nodeCount = clampInteger(options.nodeCount ?? 32, 32, 2, 512);
  const steps = clampInteger(options.steps ?? 1_000, 1_000, 1, 10_000);
  const tolerance =
    Number.isFinite(options.tolerance) && (options.tolerance ?? 0) > 0
      ? Number(options.tolerance)
      : 1e-4;
  const boundedLimit =
    Number.isFinite(options.boundedLimit) && (options.boundedLimit ?? 0) > 0
      ? Number(options.boundedLimit)
      : 1_000;

  const { initialState, sensors } = createBrowserParityInputs(
    nodeCount,
    checkpoint.latentChannels,
    checkpoint.sensorChannels,
  );

  const result = runWebGlNcaParity({
    gl,
    checkpoint,
    nodeCount,
    initialState,
    sensors,
    steps,
    tolerance,
    boundedLimit,
  });

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const unmaskedVendor = debugInfo
    ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL))
    : undefined;
  const unmaskedRenderer = debugInfo
    ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
    : undefined;

  return {
    schema: 'vector-sim-p06b-browser-parity-v1',
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    glVendor: String(gl.getParameter(gl.VENDOR)),
    glRenderer: String(gl.getParameter(gl.RENDERER)),
    unmaskedVendor,
    unmaskedRenderer,
    nodeCount,
    steps,
    tolerance,
    boundedLimit,
    checkpointVersion: checkpoint.manifest.checkpoint_version,
    checkpointSha256: checkpoint.manifest.sha256,
    pass:
      result.comparison.withinTolerance &&
      result.cpuBounded &&
      result.gpuBounded &&
      result.cpuFinite &&
      result.gpuFinite,
    result,
  };
}
