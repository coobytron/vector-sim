import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createHomeEnvironment } from '../environments/home';
import { HOME_PRESETS } from '../environments/homePresets';
import weights from '../nca/models/branching-m1.weights.json';
import { ALIVE_CHANNEL, THICKNESS_CHANNEL, loadGraphNcaModel } from '../nca/graph/graphNcaRuntime';
import type { GraphNcaWeightsJson } from '../nca/graph/graphNcaRuntime';
import { HomeWorld } from './homeWorld';
import type { HomeGoalId } from './homeWorld';

/**
 * M3 route (`?ncaHome` or `?ncaHome=<seed>`): the M1 organism in the courtyard
 * Home, Porcelain look only, one authored camera plus orbit/touch. The organism
 * is drawn as graphite lines; it carries no colour until M4's causal emission.
 * Buttons send it to the food threshold, the fault or the shelter.
 */

const TICKS_PER_SECOND = 30;
const MAX_TICKS_PER_FRAME = 4;
const GOALS: readonly { readonly id: HomeGoalId; readonly label: string }[] = [
  { id: 'food', label: 'Threshold (food)' },
  { id: 'fault', label: 'Outlet (fault)' },
  { id: 'shelter', label: 'Under stair (shelter)' },
  { id: 'stay', label: 'Stay' },
];

export function runNcaHomeRoute(root: HTMLElement, seed: number): void {
  const preset = HOME_PRESETS['courtyard-house'];
  const model = loadGraphNcaModel(weights as GraphNcaWeightsJson);
  let world = new HomeWorld(model, preset, seed);

  root.innerHTML = `
    <main style="position:fixed;inset:0;background:#f7f7f5;touch-action:none">
      <canvas style="width:100%;height:100%;display:block"></canvas>
      <section style="position:absolute;left:16px;top:16px;right:16px;max-width:420px;
        font:12px/1.5 ui-monospace,monospace;color:#202024">
        <pre data-hud style="margin:0 0 8px;padding:10px 12px;white-space:pre-wrap;
          background:rgba(255,255,255,0.88);border:1px solid rgba(32,32,36,0.14)"></pre>
        <div data-goals style="display:flex;flex-wrap:wrap;gap:6px"></div>
      </section>
    </main>`;
  const canvas = root.querySelector('canvas')!;
  const hud = root.querySelector<HTMLElement>('[data-hud]')!;
  const goals = root.querySelector<HTMLElement>('[data-goals]')!;

  const buttons = new Map<HomeGoalId, HTMLButtonElement>();
  const styleButtons = () => {
    for (const [id, button] of buttons) {
      const active = id === world.goal;
      button.style.background = active ? '#202024' : 'rgba(255,255,255,0.92)';
      button.style.color = active ? '#ffffff' : '#202024';
    }
  };
  for (const goal of [...GOALS, { id: 'reset' as const, label: 'Reset' }]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = goal.label;
    button.style.cssText = 'font:inherit;padding:6px 10px;border:1px solid rgba(32,32,36,0.24);border-radius:4px;cursor:pointer';
    button.addEventListener('click', () => {
      if (goal.id === 'reset') world = new HomeWorld(model, preset, seed);
      else world.setGoal(goal.id);
      styleButtons();
    });
    if (goal.id !== 'reset') buttons.set(goal.id, button);
    goals.append(button);
  }
  styleButtons();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf7f7f5);
  const home = createHomeEnvironment(preset, 'desktop');
  home.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  scene.add(home);
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc8c8c4, 2.1), key);

  const authored = preset.cameras.find((camera) => camera.role === 'orbit')!;
  const camera = new THREE.PerspectiveCamera(authored.fovDegrees, 1, 0.02, 60);
  camera.position.set(authored.position.x, authored.position.y, authored.position.z);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(authored.target.x, authored.target.y, authored.target.z);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 0.4;
  controls.maxDistance = 12;
  controls.update();

  // Organism: one segment per tree edge; shade from alive and thickness.
  const edgeCount = model.nodes - 1;
  const positions = new Float32Array(edgeCount * 6);
  const colors = new Float32Array(edgeCount * 6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true })));

  const syncOrganism = () => {
    let edge = 0;
    for (let node = 0; node < model.nodes; node += 1) {
      const parent = model.parents[node]!;
      if (parent < 0) continue;
      for (const [slot, index] of [[0, parent], [1, node]] as const) {
        const offset = edge * 6 + slot * 3;
        positions.set(world.positions.subarray(index * 3, index * 3 + 3), offset);
        const alive = world.state[index * model.channels + ALIVE_CHANNEL]!;
        const thickness = Math.min(1, Math.max(0, world.state[index * model.channels + THICKNESS_CHANNEL]!));
        const shade = alive > model.aliveThreshold ? 0.5 - 0.45 * thickness : 0.9;
        colors.set([shade, shade, shade], offset);
      }
      edge += 1;
    }
    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.color!.needsUpdate = true;
    geometry.computeBoundingSphere();
  };

  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / Math.max(1, clientHeight);
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  let carry = 0;
  const frame = (now: number) => {
    carry += ((now - last) / 1000) * TICKS_PER_SECOND;
    last = now;
    const ticks = Math.min(MAX_TICKS_PER_FRAME, Math.floor(carry));
    carry -= ticks;
    world.step(ticks);
    const s = world.snapshot();
    hud.textContent = [
      `M3 Home · ${preset.displayName} · seed ${seed} · tick ${s.tick}`,
      `energy ${s.energy.toFixed(3)} · health ${s.health.toFixed(3)} · ${s.status}`,
      `food ${s.food.toFixed(2)} · kill ${s.danger.toFixed(2)} · shelter ${s.shelter.toFixed(2)} · alive ${s.aliveNodes}/${model.nodes}`,
      `events ${world.events.map((event) => `${event.kind}@${event.tick}`).join(' → ')}`,
      `hash ${world.signature()}`,
    ].join('\n');
    syncOrganism();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
