import type { RuntimeCapabilities } from '../platform/capabilities';
import type { RenderMetrics } from '../rendering/vectorRenderer';
import type { QualityTier } from '../simulation/types';
import type { GpuProbeResult } from './gpuMicrobenchmarks';
import { summarize, type DistributionSummary } from './statistics';

export interface BrowserBenchmarkResult {
  schema: 'vector-sim-browser-benchmark-v1';
  timestamp: string;
  tier: string;
  hardwareMeasurement: true;
  durationMs: number;
  frames: number;
  simulationTicks: number;
  automaticQualityChanges: number;
  viewport: {
    cssWidth: number;
    cssHeight: number;
    devicePixelRatio: number;
  };
  runtime: {
    userAgent: string;
    platform: string;
    hardwareConcurrency?: number;
    deviceMemoryGb?: number;
    webgl2: boolean;
    webgpu: boolean;
  };
  frameIntervalMs: DistributionSummary;
  cpuWorkMs: DistributionSummary;
  simulationStepsPerFrame: DistributionSummary;
  renderer: RenderMetrics;
  stateHash: string;
  gpuProbes?: GpuProbeResult[];
}

export function parseBenchmarkDurationSeconds(value: string | null): number {
  if (value === null || value.trim() === '') return 8;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 8;
  return Math.min(300, Math.max(5, Math.round(seconds)));
}

interface Sample {
  nowMs: number;
  workMs: number;
  steps: number;
  renderer: RenderMetrics;
}

export class BrowserBenchmarkSession {
  private readonly startedAt = performance.now();
  private readonly intervals: number[] = [];
  private readonly work: number[] = [];
  private readonly steps: number[] = [];
  private previousFrameMs: number | undefined;
  private simulationTicks = 0;
  private latestRenderer: RenderMetrics = { calls: 0, triangles: 0, lines: 0, points: 0 };
  private complete = false;

  constructor(
    private readonly tier: QualityTier,
    private readonly capabilities: RuntimeCapabilities,
    private readonly warmupMs = 2_000,
    private readonly sampleMs = 8_000,
  ) {}

  record(sample: Sample, stateHash: () => string): BrowserBenchmarkResult | undefined {
    if (this.complete) return undefined;
    const elapsed = sample.nowMs - this.startedAt;
    if (elapsed < this.warmupMs) {
      this.previousFrameMs = sample.nowMs;
      return undefined;
    }

    if (this.previousFrameMs !== undefined) {
      this.intervals.push(sample.nowMs - this.previousFrameMs);
    }
    this.previousFrameMs = sample.nowMs;
    this.work.push(sample.workMs);
    this.steps.push(sample.steps);
    this.simulationTicks += sample.steps;
    this.latestRenderer = sample.renderer;

    if (elapsed < this.warmupMs + this.sampleMs) return undefined;
    this.complete = true;

    const hintedNavigator = navigator as Navigator & { deviceMemory?: number };
    return {
      schema: 'vector-sim-browser-benchmark-v1',
      timestamp: new Date().toISOString(),
      tier: this.tier.name,
      hardwareMeasurement: true,
      durationMs: this.sampleMs,
      frames: this.work.length,
      simulationTicks: this.simulationTicks,
      automaticQualityChanges: 0,
      viewport: {
        cssWidth: window.innerWidth,
        cssHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      runtime: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemoryGb: hintedNavigator.deviceMemory,
        webgl2: this.capabilities.webgl2,
        webgpu: this.capabilities.webgpu,
      },
      frameIntervalMs: summarize(this.intervals),
      cpuWorkMs: summarize(this.work),
      simulationStepsPerFrame: summarize(this.steps),
      renderer: this.latestRenderer,
      stateHash: stateHash(),
    };
  }
}
