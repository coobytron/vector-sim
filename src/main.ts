import './style.css';
import { createApp } from './app/createApp';
import { isJoltSpikeRequested } from './physics/joltSpikeFlag';
import { grayboxSeed, isGrayboxRequested } from './graybox/grayboxFlag';
import { isNcaHomeRequested, ncaHomeSeed } from './homeSim/homeSimFlag';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('Vector Sim requires an #app mount point.');
}

function reportStartupFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  if (root) {
    root.innerHTML = `
    <main class="fatal" role="alert">
      <p class="eyebrow">Runtime error</p>
      <h1>Vector Sim could not start.</h1>
      <p>${message}</p>
    </main>
  `;
  }
  console.error(error);
}

try {
  if (isJoltSpikeRequested(window.location.search)) {
    // Opt-in P14b measurement route. Jolt and its WASM load only here, so the
    // default app path is byte-for-byte unchanged.
    void import('./physics/joltSpikeRoute')
      .then((module) => module.runJoltBrowserSpike(root))
      .catch(reportStartupFailure);
  } else if (isGrayboxRequested(window.location.search)) {
    // Opt-in M2 graybox loop: M1 graph NCA, one room, debug lines only.
    void import('./graybox/grayboxRoute')
      .then((module) => module.runGrayboxRoute(root, grayboxSeed(window.location.search)))
      .catch(reportStartupFailure);
  } else if (isNcaHomeRequested(window.location.search)) {
    // Opt-in M3 route: the M1 graph NCA in the courtyard Home, Porcelain look.
    void import('./homeSim/homeSimRoute')
      .then((module) => module.runNcaHomeRoute(root, ncaHomeSeed(window.location.search)))
      .catch(reportStartupFailure);
  } else {
    createApp(root);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  root.innerHTML = `
    <main class="fatal" role="alert">
      <p class="eyebrow">Runtime error</p>
      <h1>Vector Sim could not start.</h1>
      <p>${message}</p>
    </main>
  `;
  console.error(error);
}

