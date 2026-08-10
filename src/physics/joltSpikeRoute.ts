import { summarize } from '../benchmark/statistics';
import type { DistributionSummary } from '../benchmark/statistics';
import { QUALITY_TIERS } from '../simulation/types';
import type { QualityTierName } from '../simulation/types';
import { PORCELAIN_TEST_SCENE } from './porcelainScene';

/**
 * Opt-in browser spike route for P14b.
 *
 * Normal app behaviour is unchanged: nothing here runs, and no WASM is fetched,
 * unless the page is loaded with `?spike=jolt`. Everything Jolt-related is
 * behind dynamic imports so the default bundle never pulls the glue in.
 */

export interface JoltTierReport {
  readonly tier: QualityTierName;
  readonly proxies: number;
  readonly physicsStepMs: DistributionSummary;
  readonly queryMs: DistributionSummary;
  readonly totalFrameMs: DistributionSummary;
  readonly budgetMs: number;
  readonly headroomAtP95: number;
  readonly stateHash: string;
  readonly sampleObservation: string;
}

export interface JoltBrowserReport {
  readonly capturedAt: string;
  readonly userAgent: string;
  readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly wasmUrl: string;
  readonly coldInitMs: number;
  readonly transferredWasmBytes: number | null;
  readonly jsHeapDeltaBytes: number | null;
  readonly tiers: readonly JoltTierReport[];
  readonly repeatRunHashes: readonly string[];
  readonly repeatRunsIdentical: boolean;
}

interface MemoryCapableWindow {
  readonly performance: Performance & { memory?: { usedJSHeapSize: number } };
}

function usedHeapBytes(): number | null {
  const memory = (globalThis as unknown as MemoryCapableWindow).performance?.memory;
  return memory === undefined ? null : memory.usedJSHeapSize;
}

/** Transferred size of the WASM asset, from Resource Timing. */
function transferredWasm(): { url: string; bytes: number | null } | null {
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const entry = entries.find((candidate) => candidate.name.endsWith('.wasm'));
  if (entry === undefined) {
    return null;
  }
  const bytes = entry.transferSize > 0 ? entry.transferSize : entry.encodedBodySize;
  return { url: entry.name, bytes: bytes > 0 ? bytes : null };
}

/** Deterministic orbit, matching the Node harness so numbers are comparable. */
function proxyPosition(index: number, frame: number, count: number) {
  const phase = (index / count) * Math.PI * 2 + frame * 0.01;
  return {
    x: Math.cos(phase) * 1.6,
    y: 0.45 + Math.sin(frame * 0.02) * 0.15,
    z: Math.sin(phase) * 1.2,
  };
}

const WARMUP_FRAMES = 30;
const SAMPLE_FRAMES = 180;

export async function runJoltBrowserSpike(root: HTMLElement): Promise<JoltBrowserReport> {
  root.innerHTML = `<main class="fatal"><p class="eyebrow">P14b spike</p><h1>Measuring Jolt…</h1></main>`;

  const [{ JoltSpatialQueryWorld }, { loadJolt }] = await Promise.all([
    import('./joltSpatialQueryWorld'),
    import('./joltLoader'),
  ]);
  // No locateFile: Vite emits the glue's own .wasm reference as a hashed asset
  // and rewrites the URL, so the default emscripten resolution is correct.


  const heapBefore = usedHeapBytes();
  const coldStart = performance.now();
  const probe = await JoltSpatialQueryWorld.create({
    scene: PORCELAIN_TEST_SCENE,
    loadJolt: () => loadJolt(),
  });
  const coldInitMs = performance.now() - coldStart;
  probe.dispose();
  const heapAfter = usedHeapBytes();

  const tiers: JoltTierReport[] = [];
  for (const tierName of ['desktop', 'mobile'] as const) {
    const tier = QUALITY_TIERS[tierName];
    const world = await JoltSpatialQueryWorld.create({
      scene: PORCELAIN_TEST_SCENE,
      loadJolt: () => loadJolt(),
    });
    for (let index = 0; index < tier.organisms; index += 1) {
      world.addProxy({
        id: `organism-${index}`,
        radius: 0.12,
        position: proxyPosition(index, 0, tier.organisms),
      });
    }

    for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
      world.step(1 / 30);
      for (const id of world.proxyIds) world.observeProxy(id);
    }

    const physics: number[] = [];
    const queries: number[] = [];
    const totals: number[] = [];
    for (let frame = 0; frame < SAMPLE_FRAMES; frame += 1) {
      const start = performance.now();
      for (let index = 0; index < tier.organisms; index += 1) {
        world.setProxyPosition(`organism-${index}`, proxyPosition(index, frame, tier.organisms));
      }
      world.step(1 / 30);
      const afterStep = performance.now();
      for (const id of world.proxyIds) {
        world.observeProxy(id);
      }
      const end = performance.now();
      physics.push(afterStep - start);
      queries.push(end - afterStep);
      totals.push(end - start);
    }

    const total = summarize(totals);
    tiers.push({
      tier: tierName,
      proxies: tier.organisms,
      physicsStepMs: summarize(physics),
      queryMs: summarize(queries),
      totalFrameMs: total,
      budgetMs: tier.targetFrameMs,
      headroomAtP95: Number((tier.targetFrameMs - total.p95).toFixed(3)),
      stateHash: world.stateHash(),
      // At least one Jolt-derived observation visible in the output.
      sampleObservation: JSON.stringify(world.observeProxy('organism-0')[0] ?? null),
    });
    world.dispose();
  }

  const repeatRunHashes: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const world = await JoltSpatialQueryWorld.create({
      scene: PORCELAIN_TEST_SCENE,
      loadJolt: () => loadJolt(),
    });
    world.addProxy({ id: 'a', radius: 0.12, position: proxyPosition(0, 0, 1) });
    for (let frame = 0; frame < 120; frame += 1) {
      world.setProxyPosition('a', proxyPosition(0, frame, 1));
      world.step(1 / 30);
      world.observeProxy('a');
    }
    repeatRunHashes.push(world.stateHash());
    world.dispose();
  }

  const wasmResource = transferredWasm();
  const report: JoltBrowserReport = {
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
    wasmUrl: wasmResource?.url ?? 'unresolved',
    coldInitMs: Number(coldInitMs.toFixed(2)),
    transferredWasmBytes: wasmResource?.bytes ?? null,
    jsHeapDeltaBytes: heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null,
    tiers,
    repeatRunHashes,
    repeatRunsIdentical: new Set(repeatRunHashes).size === 1,
  };

  renderReport(root, report);
  console.info('[p14b] jolt browser spike', report);
  return report;
}

/** Short device slug for the capture filename, e.g. `iphone-safari`. */
function deviceSlug(userAgent: string): string {
  const device = /iPhone/.test(userAgent)
    ? 'iphone'
    : /iPad/.test(userAgent)
      ? 'ipad'
      : /Macintosh/.test(userAgent)
        ? 'mac'
        : 'other';
  const engine = /CriOS|Chrome/.test(userAgent)
    ? 'chrome'
    : /Firefox|FxiOS/.test(userAgent)
      ? 'firefox'
      : /Safari/.test(userAgent)
        ? 'safari'
        : 'unknown';
  return `${device}-${engine}`;
}

/**
 * Renders the capture with one-tap download and copy.
 *
 * The D011 baselines are a MacBook and a phone; selecting JSON out of a `<pre>`
 * on a phone is miserable, so the buttons are the point of this view.
 */
function renderReport(root: HTMLElement, report: JoltBrowserReport): void {
  const verdicts = report.tiers
    .map((tier) => {
      const withinBudget = tier.totalFrameMs.p95 <= tier.budgetMs;
      return `<li><strong>${tier.tier}</strong>: total p95 ${tier.totalFrameMs.p95.toFixed(2)} ms of ${tier.budgetMs.toFixed(2)} ms budget — ${withinBudget ? 'within budget' : 'OVER BUDGET'}</li>`;
    })
    .join('');

  root.innerHTML = `
    <main class="fatal">
      <p class="eyebrow">P14b — Jolt browser spike</p>
      <h1>Measurements captured</h1>
      <ul style="text-align:left">
        <li>cold init ${report.coldInitMs.toFixed(1)} ms</li>
        <li>wasm transferred ${report.transferredWasmBytes === null ? 'unknown' : `${(report.transferredWasmBytes / 1024).toFixed(0)} KB`}</li>
        ${verdicts}
        <li>repeat runs identical: ${report.repeatRunsIdentical ? 'yes' : 'NO'}</li>
      </ul>
      <p>
        <button id="p14b-download" type="button">Download JSON</button>
        <button id="p14b-copy" type="button">Copy JSON</button>
      </p>
      <pre style="text-align:left;overflow:auto;max-height:50vh">${JSON.stringify(report, null, 2)}</pre>
    </main>
  `;

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const filename = `p14b-jolt-${deviceSlug(report.userAgent)}-${report.capturedAt.slice(0, 10)}.json`;

  root.querySelector('#p14b-download')?.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  root.querySelector('#p14b-copy')?.addEventListener('click', () => {
    void navigator.clipboard?.writeText(serialized);
  });
}
