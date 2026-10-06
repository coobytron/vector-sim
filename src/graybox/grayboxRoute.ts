import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import weights from '../nca/models/branching-m1.weights.json';
import { ALIVE_CHANNEL, THICKNESS_CHANNEL, loadGraphNcaModel } from '../nca/graph/graphNcaRuntime';
import type { GraphNcaWeightsJson } from '../nca/graph/graphNcaRuntime';
import { GrayboxWorld } from './grayboxWorld';
import type { Box2, GrayboxLayout } from './grayboxWorld';

/**
 * M2 graybox route (`?graybox` or `?graybox=<seed>`): the M1 organism in one box
 * room, drawn with debug lines only. Gray is structure, blue is the food doorway,
 * red is the kill wall. Organism edges brighten with the alive channel and darken
 * with thickness. Space pauses, `.` single-steps, `r` resets.
 */

const TICKS_PER_SECOND = 30;
const MAX_TICKS_PER_FRAME = 4;

function boxEdges(box: Box2, minY: number, maxY: number): number[] {
  const corners = [
    [box.minX, box.minZ], [box.maxX, box.minZ], [box.maxX, box.maxZ], [box.minX, box.maxZ],
  ] as const;
  const out: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const [ax, az] = corners[index]!;
    const [bx, bz] = corners[(index + 1) % 4]!;
    out.push(ax, minY, az, bx, minY, bz, ax, maxY, az, bx, maxY, bz, ax, minY, az, ax, maxY, az);
  }
  return out;
}

function lines(points: number[], color: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
}

function roomScene(layout: GrayboxLayout): THREE.Group {
  const group = new THREE.Group();
  const { room, doorway, obstacle, height } = layout;
  group.add(lines(boxEdges(room, 0, height), 0x9a9aa0));
  group.add(lines(boxEdges(obstacle, 0, 0.9), 0x6a6a70));
  const door: number[] = [];
  for (const z of [doorway.minZ, doorway.maxZ]) door.push(doorway.x, 0, z, doorway.x, doorway.height, z);
  door.push(doorway.x, doorway.height, doorway.minZ, doorway.x, doorway.height, doorway.maxZ);
  group.add(lines(door, 0x2f6fff));
  const kill: number[] = [];
  for (let x = room.minX; x <= room.maxX + 1e-6; x += 0.5) kill.push(x, 0, layout.killWallZ, x, height, layout.killWallZ);
  kill.push(room.minX, height * 0.5, layout.killWallZ, room.maxX, height * 0.5, layout.killWallZ);
  group.add(lines(kill, 0xe0342f));
  return group;
}

export function runGrayboxRoute(root: HTMLElement, seed: number): void {
  const model = loadGraphNcaModel(weights as GraphNcaWeightsJson);
  let world = new GrayboxWorld(model, seed);

  root.innerHTML = `
    <main class="graybox" style="position:fixed;inset:0;background:#f7f7f5">
      <canvas style="width:100%;height:100%;display:block"></canvas>
      <pre data-hud style="position:absolute;left:16px;top:16px;margin:0;padding:10px 12px;
        font:12px/1.5 ui-monospace,monospace;background:rgba(255,255,255,0.88);
        border:1px solid rgba(32,32,36,0.14);color:#202024;max-width:calc(100% - 32px);
        white-space:pre-wrap"></pre>
    </main>`;
  const canvas = root.querySelector('canvas')!;
  const hud = root.querySelector<HTMLElement>('[data-hud]')!;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xf7f7f5);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
  camera.position.set(-1, 5.5, -6.5);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.4, 0);
  controls.update();
  scene.add(roomScene(world.layout));

  // Organism: one segment per tree edge, with per-vertex colour.
  const edgeCount = model.nodes - 1;
  const positions = new Float32Array(edgeCount * 6);
  const colors = new Float32Array(edgeCount * 6);
  const organismGeometry = new THREE.BufferGeometry();
  organismGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  organismGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  scene.add(new THREE.LineSegments(organismGeometry, new THREE.LineBasicMaterial({ vertexColors: true })));

  const syncOrganism = () => {
    let edge = 0;
    for (let node = 0; node < model.nodes; node += 1) {
      const parent = model.parents[node]!;
      if (parent < 0) continue;
      for (const [slot, index] of [[0, parent], [1, node]] as const) {
        const offset = edge * 6 + slot * 3;
        positions.set(world.positions.subarray(index * 3, index * 3 + 3), offset);
        const alive = Math.min(1, Math.max(0, world.state[index * model.channels + ALIVE_CHANNEL]!));
        const thickness = Math.min(1, Math.max(0, world.state[index * model.channels + THICKNESS_CHANNEL]!));
        // Dead: pale gray. Alive: from mid gray (thin) to near-black (thick).
        const shade = alive > model.aliveThreshold ? 0.55 - 0.5 * thickness : 0.88;
        colors.set([shade, shade, shade], offset);
      }
      edge += 1;
    }
    organismGeometry.attributes.position!.needsUpdate = true;
    organismGeometry.attributes.color!.needsUpdate = true;
    organismGeometry.computeBoundingSphere();
  };

  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / Math.max(1, clientHeight);
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let paused = false;
  window.addEventListener('keydown', (event) => {
    if (event.key === ' ') paused = !paused;
    else if (event.key === '.') world.step();
    else if (event.key === 'r') world = new GrayboxWorld(model, seed);
    else return;
    event.preventDefault();
  });

  let last = performance.now();
  let carry = 0;
  const frame = (now: number) => {
    if (!paused) {
      carry += ((now - last) / 1000) * TICKS_PER_SECOND;
      const ticks = Math.min(MAX_TICKS_PER_FRAME, Math.floor(carry));
      carry -= ticks;
      world.step(ticks);
    } else {
      carry = 0;
    }
    last = now;
    const snapshot = world.snapshot();
    hud.textContent = [
      `M2 graybox · seed ${seed} · tick ${snapshot.tick}${paused ? ' · paused' : ''}`,
      `alive ${snapshot.aliveNodes}/${model.nodes} · killed ${snapshot.killedThisTick} · energy ${snapshot.energy.toFixed(3)}`,
      `events ${world.events.map((event) => `${event.kind}@${event.tick}`).join(' → ')}`,
      `hash ${world.signature()}`,
      'space pause · . step · r reset · drag to orbit',
    ].join('\n');
    syncOrganism();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
