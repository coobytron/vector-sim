import './style.css';
import { createApp } from './app/createApp';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('Vector Sim requires an #app mount point.');
}

try {
  createApp(root);
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

