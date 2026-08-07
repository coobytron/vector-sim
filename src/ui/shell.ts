import type { QualityTierName } from '../simulation/types';
import type { RenderMode } from '../rendering/vectorRenderer';
import type { SpectralLookName } from '../spectral/looks';
import type { MorphologyLod, OrganismVisualState } from '../organisms/types';

export interface ShellElements {
  canvas: HTMLCanvasElement;
  frame: HTMLElement;
  status: HTMLElement;
  performance: HTMLElement;
  pauseButton: HTMLButtonElement;
  recenterButton: HTMLButtonElement;
  captureButton: HTMLButtonElement;
  qualitySelect: HTMLSelectElement;
  lookSelect: HTMLSelectElement;
  stateSelect?: HTMLSelectElement;
  distanceSelect?: HTMLSelectElement;
  ncaSelect?: HTMLSelectElement;
  fallback: HTMLElement;
}

export function createShell(
  root: HTMLElement,
  quality: QualityTierName,
  mode: RenderMode,
  look: SpectralLookName,
  organismState?: OrganismVisualState,
  organismDistance: MorphologyLod = 'mid',
  ncaMode: 'live' | 'frozen' = 'live',
): ShellElements {
  const modeLink = mode === 'organisms' ? '?' : '?organisms=1&tick=180&state=feeding&distance=mid';
  const modeLabel = mode === 'organisms' ? 'Home' : 'Organisms';
  const phaseLabel = mode === 'organisms' ? 'P04 / Organism Lab' : mode === 'calibration' ? 'P03 / Calibration' : 'P04';
  const organismControls = mode === 'organisms'
    ? `
        <label>
          <span>State</span>
          <select data-state>
            <option value="" ${organismState === undefined ? 'selected' : ''}>Live</option>
            ${['dormant', 'feeding', 'starving', 'damaged', 'mutating', 'dying', 'death', 'regenerating'].map((state) => `<option value="${state}" ${organismState === state ? 'selected' : ''}>${state}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>Distance</span>
          <select data-distance>
            ${['overview', 'mid', 'macro'].map((distance) => `<option value="${distance}" ${organismDistance === distance ? 'selected' : ''}>${distance}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>NCA</span>
          <select data-nca>
            <option value="live" ${ncaMode === 'live' ? 'selected' : ''}>Live</option>
            <option value="frozen" ${ncaMode === 'frozen' ? 'selected' : ''}>Frozen</option>
          </select>
        </label>`
    : '';
  root.innerHTML = `
    <main class="app-shell">
      <header class="masthead">
        <div>
          <p class="eyebrow">Vector Sim / ${phaseLabel}</p>
          <h1>Spectral Homestead</h1>
        </div>
        <p class="status" data-status>Preparing runtime…</p>
      </header>
      <section class="viewport" aria-label="Spectral Homestead simulation viewport">
        <canvas class="scene" aria-label="Three-dimensional vector simulation"></canvas>
        <div class="fallback" data-fallback hidden></div>
        <div class="readout" aria-live="polite">
          <span data-performance>—</span>
        </div>
      </section>
      <footer class="controls" aria-label="Simulation controls">
        <button type="button" data-pause>Pause</button>
        <button type="button" data-recenter>Recenter</button>
        <button type="button" data-capture>Save PNG</button>
        <label>
          <span>Quality</span>
          <select data-quality>
            <option value="desktop" ${quality === 'desktop' ? 'selected' : ''}>Desktop</option>
            <option value="mobile" ${quality === 'mobile' ? 'selected' : ''}>Mobile</option>
          </select>
        </label>
        <label>
          <span>Look</span>
          <select data-look>
            <option value="porcelain" ${look === 'porcelain' ? 'selected' : ''}>Porcelain</option>
            <option value="technical" ${look === 'technical' ? 'selected' : ''}>Technical</option>
            <option value="ghost" ${look === 'ghost' ? 'selected' : ''}>Ghost</option>
          </select>
        </label>
        ${organismControls}
        <a href="${modeLink}">${modeLabel}</a>
        <a href="?calibration=1">Calibration</a>
        <a href="?benchmark=1&quality=${quality}">Run benchmark</a>
        <a href="?benchmark=1&quality=mobile&duration=300">5 min thermal</a>
      </footer>
    </main>
  `;

  const requireElement = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing shell element: ${selector}`);
    return element;
  };

  return {
    canvas: requireElement<HTMLCanvasElement>('canvas'),
    frame: requireElement<HTMLElement>('.viewport'),
    status: requireElement<HTMLElement>('[data-status]'),
    performance: requireElement<HTMLElement>('[data-performance]'),
    pauseButton: requireElement<HTMLButtonElement>('[data-pause]'),
    recenterButton: requireElement<HTMLButtonElement>('[data-recenter]'),
    captureButton: requireElement<HTMLButtonElement>('[data-capture]'),
    qualitySelect: requireElement<HTMLSelectElement>('[data-quality]'),
    lookSelect: requireElement<HTMLSelectElement>('[data-look]'),
    stateSelect: root.querySelector<HTMLSelectElement>('[data-state]') ?? undefined,
    distanceSelect: root.querySelector<HTMLSelectElement>('[data-distance]') ?? undefined,
    ncaSelect: root.querySelector<HTMLSelectElement>('[data-nca]') ?? undefined,
    fallback: requireElement<HTMLElement>('[data-fallback]'),
  };
}

export function showFallback(target: HTMLElement, message: string, detail: string): void {
  target.hidden = false;
  target.innerHTML = `
    <div class="fallback-card" role="alert">
      <p class="eyebrow">Compatibility fallback</p>
      <h2>${message}</h2>
      <p>${detail}</p>
    </div>
  `;
}
