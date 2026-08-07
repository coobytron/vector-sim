import type { BrowserBenchmarkResult } from '../benchmark/browserBenchmark';
import { downloadJson } from '../export/downloadJson';

export function showBenchmarkProgress(parent: HTMLElement, seconds: number): HTMLElement {
  const panel = document.createElement('aside');
  panel.className = 'benchmark-panel';
  panel.innerHTML = `
    <p class="eyebrow">Hardware benchmark</p>
    <h2>Running paired NCA + vector render</h2>
    <p data-benchmark-status>Warmup and sample: about ${seconds} seconds.</p>
  `;
  parent.append(panel);
  return panel;
}

export function showBenchmarkResult(panel: HTMLElement, result: BrowserBenchmarkResult): void {
  const frame = result.frameIntervalMs;
  const probes = (result.gpuProbes ?? [])
    .map((probe) => {
      const value = probe.samples ? `${probe.samples.median.toFixed(2)} ms median` : probe.reason;
      return `<div><dt>${probe.candidate.replace('webgl2-', '')}</dt><dd>${value ?? 'unavailable'}</dd></div>`;
    })
    .join('');
  panel.innerHTML = `
    <p class="eyebrow">Hardware benchmark complete</p>
    <h2>${result.tier} tier</h2>
    <dl>
      <div><dt>Median frame</dt><dd>${frame.median.toFixed(2)} ms</dd></div>
      <div><dt>P95 frame</dt><dd>${frame.p95.toFixed(2)} ms</dd></div>
      <div><dt>P99 frame</dt><dd>${frame.p99.toFixed(2)} ms</dd></div>
      <div><dt>Worst frame</dt><dd>${frame.max.toFixed(2)} ms</dd></div>
      <div><dt>Frames</dt><dd>${result.frames}</dd></div>
      <div><dt>State hash</dt><dd>${result.stateHash}</dd></div>
      ${probes}
    </dl>
    <button type="button" data-download-benchmark>Download JSON</button>
  `;
  panel.querySelector<HTMLButtonElement>('[data-download-benchmark]')?.addEventListener('click', () => {
    downloadJson(`vector-sim-${result.tier}-${Date.now()}.json`, result);
  });
}
