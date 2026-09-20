import type { LoadedCheckpoint } from './checkpoint/types';
import { VectorNcaReferenceKernel } from './reference/vectorNcaKernel';
import { WebGlNcaRuntime, type WebGlNcaTelemetry } from './webgl2Runtime';

export interface NcaStateComparison {
  readonly values: number;
  readonly finite: boolean;
  readonly withinTolerance: boolean;
  readonly maxAbsoluteError: number;
  readonly meanAbsoluteError: number;
  readonly rmsError: number;
  readonly overTolerance: number;
  readonly cpuSignature: string;
  readonly gpuSignature: string;
}

export interface WebGlNcaParityOptions {
  readonly gl: WebGL2RenderingContext;
  readonly checkpoint: LoadedCheckpoint;
  readonly nodeCount: number;
  readonly initialState: Float32Array;
  readonly sensors: Float32Array;
  readonly steps: number;
  readonly tolerance: number;
  readonly boundedLimit?: number;
}

export interface WebGlNcaParityResult {
  readonly steps: number;
  readonly tolerance: number;
  readonly boundedLimit: number;
  readonly comparison: NcaStateComparison;
  readonly cpuFinite: boolean;
  readonly gpuFinite: boolean;
  readonly cpuMaxAbs: number;
  readonly gpuMaxAbs: number;
  readonly cpuBounded: boolean;
  readonly gpuBounded: boolean;
  readonly telemetry: WebGlNcaTelemetry;
}

function requireFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and >= 0`);
  }
}

function maxAbs(values: Float32Array): number {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, Math.abs(value));
  return maximum;
}

function allFinite(values: Float32Array): boolean {
  for (const value of values) if (!Number.isFinite(value)) return false;
  return true;
}

export function toleranceSignature(
  values: Float32Array,
  quantum: number,
): string {
  if (!(quantum > 0) || !Number.isFinite(quantum)) {
    throw new RangeError('signature quantum must be finite and > 0');
  }
  let hash = 0x811c9dc5;
  for (const value of values) {
    const quantized = Number.isFinite(value) ? Math.round(value / quantum) : 0x7fffffff;
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (quantized >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

export function compareNcaStates(
  cpu: Float32Array,
  gpu: Float32Array,
  tolerance: number,
): NcaStateComparison {
  requireFiniteNonNegative(tolerance, 'tolerance');
  if (cpu.length !== gpu.length) {
    throw new RangeError(`state lengths differ: CPU ${cpu.length}, GPU ${gpu.length}`);
  }

  let maxAbsoluteError = 0;
  let sumAbsolute = 0;
  let sumSquared = 0;
  let overTolerance = 0;
  let finite = true;

  for (let index = 0; index < cpu.length; index += 1) {
    const expected = cpu[index] ?? 0;
    const actual = gpu[index] ?? 0;
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
      finite = false;
      overTolerance += 1;
      continue;
    }
    const error = Math.abs(actual - expected);
    maxAbsoluteError = Math.max(maxAbsoluteError, error);
    sumAbsolute += error;
    sumSquared += error * error;
    if (error > tolerance) overTolerance += 1;
  }

  const values = cpu.length;
  const quantum = Math.max(tolerance * 2, 1e-7);
  return {
    values,
    finite,
    withinTolerance: finite && overTolerance === 0,
    maxAbsoluteError,
    meanAbsoluteError: values === 0 ? 0 : sumAbsolute / values,
    rmsError: values === 0 ? 0 : Math.sqrt(sumSquared / values),
    overTolerance,
    cpuSignature: toleranceSignature(cpu, quantum),
    gpuSignature: toleranceSignature(gpu, quantum),
  };
}

export function runWebGlNcaParity(
  options: WebGlNcaParityOptions,
): WebGlNcaParityResult {
  if (!Number.isInteger(options.steps) || options.steps < 0) {
    throw new RangeError('steps must be a non-negative integer');
  }
  requireFiniteNonNegative(options.tolerance, 'tolerance');
  const boundedLimit = options.boundedLimit ?? 1_000;
  if (!(boundedLimit > 0) || !Number.isFinite(boundedLimit)) {
    throw new RangeError('boundedLimit must be finite and > 0');
  }

  const expectedStateLength = options.nodeCount * options.checkpoint.latentChannels;
  const expectedSensorLength = options.nodeCount * options.checkpoint.sensorChannels;
  if (options.initialState.length !== expectedStateLength) {
    throw new RangeError(
      `initialState length ${options.initialState.length} does not match ${expectedStateLength}`,
    );
  }
  if (options.sensors.length !== expectedSensorLength) {
    throw new RangeError(
      `sensors length ${options.sensors.length} does not match ${expectedSensorLength}`,
    );
  }

  const kernel = new VectorNcaReferenceKernel(options.checkpoint);
  let cpuRead = options.initialState.slice();
  let cpuWrite = new Float32Array(cpuRead.length);
  const gpu = new WebGlNcaRuntime({
    gl: options.gl,
    checkpoint: options.checkpoint,
    nodeCount: options.nodeCount,
  });

  try {
    gpu.seed(options.initialState);
    gpu.setSensors(options.sensors);

    for (let step = 0; step < options.steps; step += 1) {
      kernel.step(cpuRead, options.sensors, options.nodeCount, cpuWrite);
      const swap = cpuRead;
      cpuRead = cpuWrite;
      cpuWrite = swap;
      gpu.step();
    }

    const gpuState = gpu.readStateForValidation();
    const comparison = compareNcaStates(cpuRead, gpuState, options.tolerance);
    const cpuFinite = allFinite(cpuRead);
    const gpuFinite = allFinite(gpuState);
    const cpuMaxAbs = maxAbs(cpuRead);
    const gpuMaxAbs = maxAbs(gpuState);

    return {
      steps: options.steps,
      tolerance: options.tolerance,
      boundedLimit,
      comparison,
      cpuFinite,
      gpuFinite,
      cpuMaxAbs,
      gpuMaxAbs,
      cpuBounded: cpuFinite && cpuMaxAbs <= boundedLimit,
      gpuBounded: gpuFinite && gpuMaxAbs <= boundedLimit,
      telemetry: gpu.telemetry,
    };
  } finally {
    gpu.dispose();
  }
}
