import type { QualityTierName } from '../simulation/types';

export interface ShellElements {
  canvas: HTMLCanvasElement;
  frame: HTMLElement;
  status: HTMLElement;
  performance: HTMLElement;
  pauseButton: HTMLButtonElement;
  recenterButton: HTMLButtonElement;
  qualitySelect: HTMLSelectElement;
  fallback: HTMLElement;
}

export function createShell(root: HTMLElement, quality: QualityTierName): ShellElements {
  root.innerHTML = `
    <main class="app-shell">
      <header class="masthead">
        <div>
          <p class="eyebrow">Vector Sim / P02</p>
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
        <label>
          <span>Quality</span>
          <select data-quality>
            <option value="desktop" ${quality === 'desktop' ? 'selected' : ''}>Desktop</option>
            <option value="mobile" ${quality === 'mobile' ? 'selected' : ''}>Mobile</option>
          </select>
        </label>
        <a href="?benchmark=1&quality=${quality}">Run benchmark</a>
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
    qualitySelect: requireElement<HTMLSelectElement>('[data-quality]'),
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

