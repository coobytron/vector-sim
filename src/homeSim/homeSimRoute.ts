import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createHomeEnvironment } from '../environments/home';
import { HOME_PRESETS } from '../environments/homePresets';
import weights from '../nca/models/branching-m1.weights.json';
import { ALIVE_CHANNEL, THICKNESS_CHANNEL, loadGraphNcaModel } from '../nca/graph/graphNcaRuntime';
import type { GraphNcaWeightsJson } from '../nca/graph/graphNcaRuntime';
import { SPECTRAL_LOOKS } from '../spectral/looks';
import { computeHomeEmission } from './homeEmission';
import { exportHomeState, replayHomeWorld, restoreHomeState } from './homeReplay';
import type { HomeCameraState, HomeStateV1 } from './homeReplay';
import { HomeWorld } from './homeWorld';
import type { HomeGoalId } from './homeWorld';

/**
 * M3/M4 route (`?ncaHome` or `?ncaHome=<seed>`): the M1 organism in the courtyard
 * Home, Porcelain look only, one authored camera plus orbit/touch. The organism
 * is graphite lines; colour comes only from causal emission (feeding, damage,
 * regeneration). Buttons send it to the food threshold, the fault or the
 * shelter, replay the input timeline, export or import the state, and export
 * a PNG of the current frame without the HUD.
 */

const TICKS_PER_SECOND = 30;
const MAX_TICKS_PER_FRAME = 4;
const LOOK = SPECTRAL_LOOKS.porcelain;
/** Largest PNG export, per the brief. */
export const MAX_EXPORT_WIDTH = 3840;
export const MAX_EXPORT_HEIGHT = 2160;
const GLOW_SIZE_METERS = 0.06;
const TRANSFER_BEADS = 6;

/**
 * Display form of a node's linear emission: the hue at full value plus a
 * coverage alpha that rises with strength, so weak but real events still read
 * against the white world. Zero emission stays fully transparent.
 */
function displayHue(colors: Float32Array, node: number): [number, number, number, number] {
  const r = colors[node * 3]!;
  const g = colors[node * 3 + 1]!;
  const b = colors[node * 3 + 2]!;
  const peak = Math.max(r, g, b);
  if (peak <= 0) return [0, 0, 0, 0];
  return [r / peak, g / peak, b / peak, Math.min(1, 0.45 + 1.5 * peak)];
}
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
        <div data-tools style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px"></div>
        <input data-import type="file" accept="application/json" hidden>
      </section>
    </main>`;
  const canvas = root.querySelector('canvas')!;
  const hud = root.querySelector<HTMLElement>('[data-hud]')!;
  const goals = root.querySelector<HTMLElement>('[data-goals]')!;
  const tools = root.querySelector<HTMLElement>('[data-tools]')!;
  const importInput = root.querySelector<HTMLInputElement>('[data-import]')!;
  let paused = false;
  let notice = '';

  const buttons = new Map<HomeGoalId, HTMLButtonElement>();
  const styleButtons = () => {
    for (const [id, button] of buttons) {
      const active = id === world.goal;
      button.style.background = active ? '#202024' : 'rgba(255,255,255,0.92)';
      button.style.color = active ? '#ffffff' : '#202024';
    }
  };
  const makeButton = (label: string, parent: HTMLElement, onClick: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = 'font:inherit;padding:6px 10px;border:1px solid rgba(32,32,36,0.24);border-radius:4px;cursor:pointer;background:rgba(255,255,255,0.92);color:#202024';
    button.addEventListener('click', onClick);
    parent.append(button);
    return button;
  };
  for (const goal of [...GOALS, { id: 'reset' as const, label: 'Reset' }]) {
    const button = makeButton(goal.label, goals, () => {
      if (goal.id === 'reset') world = new HomeWorld(model, preset, seed);
      else world.setGoal(goal.id);
      styleButtons();
    });
    if (goal.id !== 'reset') buttons.set(goal.id, button);
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

  const cameraState = (): HomeCameraState => ({
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [controls.target.x, controls.target.y, controls.target.z],
    fovDegrees: camera.fov,
  });
  const applyCamera = (state: HomeCameraState) => {
    camera.position.set(...state.position);
    controls.target.set(...state.target);
    camera.fov = state.fovDegrees;
    camera.updateProjectionMatrix();
    controls.update();
  };

  // Organism: one segment per tree edge; shade from alive and thickness.
  const edgeCount = model.nodes - 1;
  const positions = new Float32Array(edgeCount * 6);
  const colors = new Float32Array(edgeCount * 6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true })));

  // Causal emission. The world is white, so colour is painted over it (normal
  // blending), never added: soft dots at lit nodes, a source-to-node transfer
  // line, and beads travelling along it toward the organism.
  const glowCapacity = model.nodes + 2 * TRANSFER_BEADS;
  const glowPositions = new Float32Array(glowCapacity * 3);
  const glowColors = new Float32Array(glowCapacity * 4);
  const glowGeometry = new THREE.BufferGeometry();
  glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
  glowGeometry.setAttribute('color', new THREE.BufferAttribute(glowColors, 4));
  const glow = new THREE.Points(glowGeometry, new THREE.PointsMaterial({
    size: GLOW_SIZE_METERS,
    map: glowSprite(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  }));
  glow.frustumCulled = false;
  glow.renderOrder = 2;
  const transferPositions = new Float32Array(2 * 2 * 3);
  const transferColors = new Float32Array(2 * 2 * 4);
  const transferGeometry = new THREE.BufferGeometry();
  transferGeometry.setAttribute('position', new THREE.BufferAttribute(transferPositions, 3));
  transferGeometry.setAttribute('color', new THREE.BufferAttribute(transferColors, 4));
  const transfers = new THREE.LineSegments(transferGeometry, new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  }));
  transfers.frustumCulled = false;
  transfers.renderOrder = 1;
  scene.add(glow, transfers);

  const syncOrganism = () => {
    const emission = computeHomeEmission(world, LOOK);
    const hues = Array.from({ length: model.nodes }, (_, node) => displayHue(emission.nodeColors, node));
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
        const hue = hues[index]!;
        colors.set([0, 1, 2].map((channel) => shade + (hue[channel]! - shade) * hue[3]!), offset);
      }
      edge += 1;
    }
    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.color!.needsUpdate = true;
    geometry.computeBoundingSphere();

    glowPositions.fill(0);
    glowColors.fill(0);
    glowPositions.set(world.positions);
    hues.forEach((hue, node) => glowColors.set(hue, node * 4));
    transferPositions.fill(0);
    transferColors.fill(0);
    emission.lines.slice(0, 2).forEach((line, index) => {
      const hue = displayHue(Float32Array.from(line.color), 0);
      transferPositions.set([...line.from, ...line.to], index * 6);
      transferColors.set([...hue, ...hue], index * 8);
      for (let bead = 0; bead < TRANSFER_BEADS; bead += 1) {
        // Beads travel from the source to the organism, one bead spacing per 8 ticks.
        const t = (bead + (world.tick % 8) / 8) / TRANSFER_BEADS;
        const slot = model.nodes + index * TRANSFER_BEADS + bead;
        glowPositions.set([0, 1, 2].map((axis) => line.from[axis]! + (line.to[axis]! - line.from[axis]!) * t), slot * 3);
        glowColors.set([hue[0]!, hue[1]!, hue[2]!, hue[3]! * (0.35 + 0.65 * t)], slot * 4);
      }
    });
    glowGeometry.attributes.position!.needsUpdate = true;
    glowGeometry.attributes.color!.needsUpdate = true;
    transferGeometry.attributes.position!.needsUpdate = true;
    transferGeometry.attributes.color!.needsUpdate = true;
    return emission;
  };

  /** Renders the current frame offscreen at `width × height` (no HUD) and returns PNG bytes as a data URL. */
  const exporters = new Map<string, THREE.WebGLRenderer>();
  const exportPng = (width: number, height: number): string => {
    const w = Math.max(1, Math.min(MAX_EXPORT_WIDTH, Math.round(width)));
    const h = Math.max(1, Math.min(MAX_EXPORT_HEIGHT, Math.round(height)));
    const key = `${w}x${h}`;
    let exporter = exporters.get(key);
    if (!exporter) {
      const target = document.createElement('canvas');
      exporter = new THREE.WebGLRenderer({ canvas: target, antialias: true, preserveDrawingBuffer: true });
      exporter.setPixelRatio(1);
      exporter.setSize(w, h, false);
      exporter.shadowMap.enabled = true;
      exporter.shadowMap.type = THREE.PCFSoftShadowMap;
      exporters.set(key, exporter);
    }
    syncOrganism();
    const shot = camera.clone();
    shot.aspect = w / h;
    shot.updateProjectionMatrix();
    exporter.render(scene, shot);
    return exporter.domElement.toDataURL('image/png');
  };

  const download = (href: string, name: string) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = name;
    link.click();
  };
  const currentState = () => exportHomeState(world, LOOK.name, cameraState());
  const importState = (value: unknown): HomeStateV1 => {
    const restored = restoreHomeState(model, value);
    world = restored.world;
    applyCamera(restored.state.camera);
    styleButtons();
    return restored.state;
  };
  const replay = (): boolean => {
    const replayed = replayHomeWorld(model, preset, seed, world.inputs, world.tick);
    const match = replayed.signature() === world.signature();
    if (match) world = replayed;
    return match;
  };

  const pauseButton = makeButton('Pause', tools, () => {
    paused = !paused;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
  });
  makeButton('Replay', tools, () => {
    notice = replay() ? `replayed ${world.inputs.length} inputs to tick ${world.tick}: hash matches` : 'replay hash MISMATCH';
  });
  makeButton('Export state', tools, () => {
    const state = currentState();
    download(URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })), `home-seed${seed}-tick${state.tick}.json`);
  });
  makeButton('Import state', tools, () => importInput.click());
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    void file.text().then((text) => {
      try {
        const state = importState(JSON.parse(text));
        notice = `restored tick ${state.tick} (hash ${state.hash})`;
      } catch (error) {
        notice = error instanceof Error ? error.message : String(error);
      }
    });
  });
  makeButton('PNG 1920×1080', tools, () => download(exportPng(1920, 1080), `home-seed${seed}-tick${world.tick}-1080p.png`));
  makeButton('PNG 3840×2160', tools, () => download(exportPng(3840, 2160), `home-seed${seed}-tick${world.tick}-4k.png`));

  // Automation hook for headless checks (PNG determinism, white-pixel rule).
  (window as unknown as { __ncaHome?: unknown }).__ncaHome = {
    get world() { return world; },
    setPaused: (value: boolean) => { paused = value; pauseButton.textContent = paused ? 'Resume' : 'Pause'; },
    setGoal: (goal: HomeGoalId) => { world.setGoal(goal); styleButtons(); },
    step: (ticks: number) => world.step(ticks),
    exportState: currentState,
    importState,
    exportPng,
    replay,
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
    const ticks = paused ? 0 : Math.min(MAX_TICKS_PER_FRAME, Math.floor(carry));
    carry = paused ? 0 : carry - ticks;
    world.step(ticks);
    const s = world.snapshot();
    hud.textContent = [
      `M4 Home · ${preset.displayName} · seed ${seed} · tick ${s.tick}${paused ? ' · paused' : ''}`,
      `energy ${s.energy.toFixed(3)} · health ${s.health.toFixed(3)} · ${s.status}`,
      `food ${s.food.toFixed(2)} · kill ${s.danger.toFixed(2)} · shelter ${s.shelter.toFixed(2)} · alive ${s.aliveNodes}/${model.nodes}`,
      `events ${world.events.map((event) => `${event.kind}@${event.tick}`).join(' → ')}`,
      `hash ${world.signature()}`,
      ...(notice ? [notice] : []),
    ].join('\n');
    syncOrganism();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Soft round sprite for emission glow points. */
function glowSprite(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
