export interface DistributionSummary {
  count: number;
  min: number;
  median: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;
  return (sorted[lower] ?? 0) * (1 - fraction) + (sorted[upper] ?? 0) * fraction;
}

export function summarize(samples: number[]): DistributionSummary {
  if (samples.length === 0) {
    return { count: 0, min: 0, median: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? 0,
    mean: total / sorted.length,
  };
}

