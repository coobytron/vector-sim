import type { QualityTierName } from '../simulation/types';
import type { RenderMode } from '../rendering/vectorRenderer';
import type { SpectralLookName } from '../spectral/looks';

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
  fallback: HTMLElement;
}

export function createShell(
  root: HTMLElement,
  quality: QualityTierName,
  mode: RenderMode,
  look: SpectralLookName,
): ShellElements {
  const modeLink = mode === 'calibration' ? '?' : '?calibration=1';
  const modeLabel = mode === 'calibration' ? 'Home' : 'Calibration';
  root.innerHTML = `
    <main class="app-shell">
      <header class="masthead">
        <div>
          <p class="eyebrow">Vector Sim / P03${mode === 'calibration' ? ' / Calibration' : ''}</p>
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
        <a href="${modeLink}">${modeLabel}</a>
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
