import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createHomeEnvironment } from '../environments/home';
import { describeOutputCapture, downloadCanvasPng } from '../export/colorContract';
import { effectivePixelRatio } from '../platform/capabilities';
import type { QualityTier, SimulationSnapshot } from '../simulation/types';
import {
  evaluateSpectralColor,
  spectralEmissionLinear,
  type Rgb,
  type SpectralColorSample,
} from '../spectral/color';
import { sampleSpectralEvent } from '../spectral/events';
import type { SpectralLookProfile } from '../spectral/looks';
import { HomeSpectralEmitters } from './homeSpectralEmitters';
import { SpectralCalibrationScene } from './spectralCalibrationScene';
import { SpectralPostProcessor } from './spectralPostProcessor';
import { VectorBufferPacker } from './vectorBufferPacker';

export interface RenderMetrics {
  calls: number;
  triangles: number;
  lines: number;
  points: number;
}

export type RenderMode = 'home' | 'calibration';

export interface VectorRendererOptions {
  mode: RenderMode;
  look: SpectralLookProfile;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function colorFromLinear(color: Rgb, target = new THREE.Color()): THREE.Color {
  return target.setRGB(color.r, color.g, color.b, THREE.LinearSRGBColorSpace);
}

export class VectorRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;

  private readonly nodes: THREE.InstancedMesh;
  private readonly emissionNodes: THREE.InstancedMesh;
  private readonly edgeGeometry: THREE.BufferGeometry;
  private readonly emissionEdgeGeometry: THREE.BufferGeometry;
  private readonly emissionEdgeColors: Float32Array;
  private readonly nodeEmissionColors: Float32Array;
  private readonly nodeEmissionStrengths: Float32Array;
  private readonly ribbonGeometry: THREE.BufferGeometry;
  private readonly packer: VectorBufferPacker;
  private readonly transform = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly color = new THREE.Color();
  private readonly resizeObserver: ResizeObserver;
  private readonly postProcessor: SpectralPostProcessor;
  private readonly homeEmitters?: HomeSpectralEmitters;
  private readonly calibration?: SpectralCalibrationScene;
  private readonly mode: RenderMode;
  private look: SpectralLookProfile;
  private debugSample: SpectralColorSample;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly tier: QualityTier,
    snapshot: SimulationSnapshot,
    options: VectorRendererOptions,
  ) {
    this.mode = options.mode;
    this.look = options.look;
    this.debugSample = evaluateSpectralColor(532, 2.5, options.look.exposure);
    this.scene.background = new THREE.Color(0xf7f7f5);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: tier.name === 'desktop',
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.shadowMap.enabled = tier.name === 'desktop';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    if (this.mode === 'calibration') {
      this.camera.position.set(0, 0.15, 8.8);
    } else {
      this.camera.position.set(5.4, 3.75, 6.2);
    }
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, this.mode === 'calibration' ? 0 : 1.0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = this.mode === 'calibration' ? 6.5 : 4.0;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.update();

    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(4, 7, 5);
    key.castShadow = tier.name === 'desktop';
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc8c8c4, 2.1), key);

    if (this.mode === 'calibration') {
      this.calibration = new SpectralCalibrationScene(options.look);
      this.scene.add(this.calibration.group);
    } else {
      this.scene.add(createHomeEnvironment());
      this.homeEmitters = new HomeSpectralEmitters(options.look);
      this.scene.add(this.homeEmitters.group);
    }

    const nodeGeometry = new THREE.IcosahedronGeometry(0.035, 1);
    const nodeMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2f2ef,
      roughness: 0.48,
      metalness: 0.02,
    });
    this.nodes = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, snapshot.active.length);
    this.nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nodes.frustumCulled = false;
    this.nodes.visible = this.mode === 'home';
    this.scene.add(this.nodes);

    const emissionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: true,
    });
    this.emissionNodes = new THREE.InstancedMesh(
      nodeGeometry.clone(),
      emissionMaterial,
      snapshot.active.length,
    );
    this.emissionNodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.emissionNodes.frustumCulled = false;
    this.emissionNodes.visible = this.mode === 'home';
    this.scene.add(this.emissionNodes);

    this.nodeEmissionColors = new Float32Array(snapshot.active.length * 3);
    this.nodeEmissionStrengths = new Float32Array(snapshot.active.length);
    this.packer = new VectorBufferPacker(snapshot);
    this.edgeGeometry = new THREE.BufferGeometry();
    this.edgeGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.packer.buffers.edgePositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    const lines = new THREE.LineSegments(
      this.edgeGeometry,
      new THREE.LineBasicMaterial({ color: 0x54545a, transparent: true, opacity: 0.72 }),
    );
    lines.frustumCulled = false;
    lines.visible = this.mode === 'home';
    this.scene.add(lines);

    this.emissionEdgeColors = new Float32Array(this.packer.buffers.edgePositions.length);
    this.emissionEdgeGeometry = new THREE.BufferGeometry();
    this.emissionEdgeGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.packer.buffers.edgePositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.emissionEdgeGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.emissionEdgeColors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    const emissionLines = new THREE.LineSegments(
      this.emissionEdgeGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: true,
      }),
    );
    emissionLines.frustumCulled = false;
    emissionLines.visible = this.mode === 'home';
    this.scene.add(emissionLines);

    const ribbonCount = this.packer.buffers.ribbonCount;
    const ribbonIndices = new Uint32Array(ribbonCount * 6);
    for (let ribbon = 0; ribbon < ribbonCount; ribbon += 1) {
      const vertex = ribbon * 4;
      const index = ribbon * 6;
      ribbonIndices.set([vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3], index);
    }
    this.ribbonGeometry = new THREE.BufferGeometry();
    this.ribbonGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.packer.buffers.ribbonPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.ribbonGeometry.setIndex(new THREE.BufferAttribute(ribbonIndices, 1));
    const ribbons = new THREE.Mesh(
      this.ribbonGeometry,
      new THREE.MeshStandardMaterial({
        color: 0xbcbcc0,
        roughness: 0.62,
        metalness: 0.02,
        side: THREE.DoubleSide,
      }),
    );
    ribbons.frustumCulled = false;
    ribbons.visible = this.mode === 'home';
    this.scene.add(ribbons);

    this.postProcessor = new SpectralPostProcessor(
      this.renderer,
      this.scene,
      this.camera,
      options.look,
    );
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  update(snapshot: SimulationSnapshot, alpha: number): RenderMetrics {
    const buffers = this.packer.update(snapshot, alpha);

    for (let node = 0; node < snapshot.active.length; node += 1) {
      const offset = node * 3;
      this.position.set(
        buffers.nodePositions[offset] ?? 0,
        buffers.nodePositions[offset + 1] ?? 0,
        buffers.nodePositions[offset + 2] ?? 0,
      );
      this.scale.setScalar(buffers.nodeScales[node] ?? 0);
      this.transform.compose(this.position, this.rotation, this.scale);
      this.nodes.setMatrixAt(node, this.transform);

      const energy = snapshot.energy[node] ?? 0;
      const health = snapshot.health[node] ?? 1;
      const feedingStrength = clamp01((energy - 0.65) * 9);
      const damageStrength = clamp01((1 - health) * 5);
      const strength = Math.max(feedingStrength, damageStrength);
      this.nodeEmissionStrengths[node] = strength;
      const localPhase = snapshot.tick / 90 - node / Math.max(1, snapshot.active.length);
      const event = damageStrength > feedingStrength ? 'damage' : 'feeding';
      const semantic = sampleSpectralEvent(event, localPhase);
      const emission = spectralEmissionLinear(
        semantic.wavelengthNm,
        strength * semantic.intensityScale * 3.2 * this.look.emissionScale,
      );
      this.nodeEmissionColors[offset] = emission.r;
      this.nodeEmissionColors[offset + 1] = emission.g;
      this.nodeEmissionColors[offset + 2] = emission.b;
      colorFromLinear(emission, this.color);
      this.emissionNodes.setColorAt(node, this.color);
      this.scale.setScalar(strength <= 0.001 ? 0 : (buffers.nodeScales[node] ?? 0) * (1.1 + strength * 0.4));
      this.transform.compose(this.position, this.rotation, this.scale);
      this.emissionNodes.setMatrixAt(node, this.transform);
    }
    this.nodes.instanceMatrix.needsUpdate = true;
    this.emissionNodes.instanceMatrix.needsUpdate = true;
    if (this.emissionNodes.instanceColor) this.emissionNodes.instanceColor.needsUpdate = true;

    const edgeAttribute = this.edgeGeometry.getAttribute('position');
    edgeAttribute.needsUpdate = true;
    this.emissionEdgeGeometry.getAttribute('position').needsUpdate = true;
    for (let edgeIndex = 0; edgeIndex < snapshot.edges.length; edgeIndex += 2) {
      const startNode = snapshot.edges[edgeIndex] ?? 0;
      const endNode = snapshot.edges[edgeIndex + 1] ?? startNode;
      const startColor = startNode * 3;
      const endColor = endNode * 3;
      const write = edgeIndex * 3;
      const startStrength = this.nodeEmissionStrengths[startNode] ?? 0;
      const endStrength = this.nodeEmissionStrengths[endNode] ?? 0;
      const edgeScale = Math.max(startStrength, endStrength) * 0.9;
      for (let channel = 0; channel < 3; channel += 1) {
        this.emissionEdgeColors[write + channel] =
          (this.nodeEmissionColors[startColor + channel] ?? 0) * edgeScale;
        this.emissionEdgeColors[write + 3 + channel] =
          (this.nodeEmissionColors[endColor + channel] ?? 0) * edgeScale;
      }
    }
    this.emissionEdgeGeometry.getAttribute('color').needsUpdate = true;

    const ribbonAttribute = this.ribbonGeometry.getAttribute('position');
    ribbonAttribute.needsUpdate = true;
    this.ribbonGeometry.computeVertexNormals();

    this.homeEmitters?.update(snapshot.tick, alpha);
    this.calibration?.update(snapshot.tick, alpha);
    this.controls.update();
    this.postProcessor.render(1 / Math.max(1, this.tier.targetFps));
    const info = this.renderer.info.render;
    return { calls: info.calls, triangles: info.triangles, lines: info.lines, points: info.points };
  }

  setLook(look: SpectralLookProfile): void {
    this.look = look;
    this.postProcessor.setLook(look);
    this.homeEmitters?.setLook(look);
    this.calibration?.setLook(look);
    this.setSpectralProbe(
      evaluateSpectralColor(
        this.debugSample.wavelengthNm,
        this.debugSample.intensity,
        look.exposure,
      ),
    );
  }

  setExposure(exposure: number): void {
    this.postProcessor.setExposure(exposure);
  }

  setSpectralProbe(sample: SpectralColorSample): void {
    this.debugSample = sample;
    this.calibration?.setProbe(sample);
  }

  outputDescriptor(): ReturnType<typeof describeOutputCapture> {
    return describeOutputCapture(this.look);
  }

  capturePng(): Promise<void> {
    return downloadCanvasPng(this.canvas, `spectral-homestead-${this.mode}-${Date.now()}.png`);
  }

  recenter(): void {
    if (this.mode === 'calibration') {
      this.camera.position.set(0, 0.15, 8.8);
      this.controls.target.set(0, 0, 0);
    } else {
      this.camera.position.set(5.4, 3.75, 6.2);
      this.controls.target.set(0, 1.0, 0);
    }
    this.controls.update();
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    const dpr = effectivePixelRatio(width, height, window.devicePixelRatio, this.tier);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.postProcessor.resize(width, height, dpr);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
        geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.postProcessor.dispose();
    this.renderer.dispose();
  }
}
