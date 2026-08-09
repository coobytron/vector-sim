import './style.css';
import { createApp } from './app/createApp';
import { isJoltSpikeRequested } from './physics/joltSpikeFlag';

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

