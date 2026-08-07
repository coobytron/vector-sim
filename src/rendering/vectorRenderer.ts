import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createHomeEnvironment } from '../environments/home';
import { describeOutputCapture, downloadCanvasPng } from '../export/colorContract';
import { selectMorphologyLod } from '../organisms/morphology';
import type { MorphologyLod, OrganismVisualState } from '../organisms/types';
import { effectivePixelRatio } from '../platform/capabilities';
import type { QualityTier, SimulationSnapshot } from '../simulation/types';
import {
  evaluateSpectralColor,
  LIFE_WAVELENGTH_NM,
  spectralEmissionLinear,
  type Rgb,
  type SpectralColorSample,
} from '../spectral/color';
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

export type RenderMode = 'home' | 'calibration' | 'organisms';

export interface VectorRendererOptions {
  mode: RenderMode;
  look: SpectralLookProfile;
  captureState?: OrganismVisualState;
  captureDistance?: MorphologyLod;
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
  private readonly nodeMaterial: THREE.MeshStandardMaterial;
  private readonly emissionNodes: THREE.InstancedMesh;
  private readonly edgeGeometry: THREE.BufferGeometry;
  private readonly edgeMaterial: THREE.LineBasicMaterial;
  private readonly emissionEdgeGeometry: THREE.BufferGeometry;
  private readonly emissionEdgeColors: Float32Array;
  private readonly nodeEmissionColors: Float32Array;
  private readonly nodeEmissionStrengths: Float32Array;
  private readonly ribbonGeometry: THREE.BufferGeometry;
  private readonly ribbonMaterial: THREE.MeshStandardMaterial;
  private readonly faceGeometry: THREE.BufferGeometry;
  private readonly faceMaterial: THREE.MeshStandardMaterial;
  private readonly forwardMarkers: THREE.InstancedMesh;
  private readonly forwardMaterial: THREE.MeshStandardMaterial;
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
  private readonly fixedLod?: MorphologyLod;
  private readonly packOptions: { lod: MorphologyLod; stateOverride?: OrganismVisualState } = {
    lod: 'macro',
  };
  private look: SpectralLookProfile;
  private debugSample: SpectralColorSample;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly tier: QualityTier,
    snapshot: SimulationSnapshot,
    options: VectorRendererOptions,
  ) {
    this.mode = options.mode;
    this.fixedLod = options.captureDistance;
    this.packOptions.stateOverride = options.captureState;
    this.look = options.look;
    this.debugSample = evaluateSpectralColor(
      LIFE_WAVELENGTH_NM,
      2.5,
      options.look.exposure,
      undefined,
      options.look.outputSaturation,
    );
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
    } else if (this.mode === 'organisms') {
      this.setOrganismCamera(options.captureDistance ?? 'mid');
    } else {
      this.camera.position.set(5.4, 3.75, 6.2);
    }
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, this.mode === 'calibration' ? 0 : this.mode === 'organisms' ? 0.72 : 1.0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = this.mode === 'calibration' ? 6.5 : this.mode === 'organisms' ? 2.2 : 4.0;
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
    } else if (this.mode === 'home') {
      this.scene.add(createHomeEnvironment());
      this.homeEmitters = new HomeSpectralEmitters(options.look);
      this.scene.add(this.homeEmitters.group);
    } else {
      const stage = new THREE.Mesh(
        new THREE.CircleGeometry(2.35, 96),
        new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.78, metalness: 0 }),
      );
      stage.rotation.x = -Math.PI / 2;
      stage.position.y = 0.03;
      stage.receiveShadow = tier.name === 'desktop';
      this.scene.add(stage);
    }

    const nodeGeometry = new THREE.IcosahedronGeometry(0.035, 1);
    this.nodeMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2f2ef,
      roughness: 0.48,
      metalness: 0.02,
    });
    this.nodes = new THREE.InstancedMesh(nodeGeometry, this.nodeMaterial, snapshot.active.length);
    this.nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nodes.frustumCulled = false;
    this.nodes.visible = this.mode !== 'calibration';
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
    this.emissionNodes.visible = this.mode !== 'calibration';
    this.scene.add(this.emissionNodes);

    this.nodeEmissionColors = new Float32Array(snapshot.active.length * 3);
    this.nodeEmissionStrengths = new Float32Array(snapshot.active.length);
    this.packer = new VectorBufferPacker(snapshot);
    this.edgeGeometry = new THREE.BufferGeometry();
    this.edgeGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.packer.buffers.edgePositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x54545a,
      transparent: true,
      opacity: 0.72,
    });
    const lines = new THREE.LineSegments(this.edgeGeometry, this.edgeMaterial);
    lines.frustumCulled = false;
    lines.visible = this.mode !== 'calibration';
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
    emissionLines.visible = this.mode !== 'calibration';
    this.scene.add(emissionLines);

    this.faceGeometry = new THREE.BufferGeometry();
    this.faceGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.packer.buffers.facePositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.faceGeometry.computeVertexNormals();
    this.faceMaterial = new THREE.MeshStandardMaterial({
      color: 0xd9d9de,
      roughness: 0.74,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    });
    const faces = new THREE.Mesh(this.faceGeometry, this.faceMaterial);
    faces.frustumCulled = false;
    faces.visible = this.mode !== 'calibration';
    this.scene.add(faces);

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
    this.ribbonMaterial = new THREE.MeshStandardMaterial({
      color: 0xbcbcc0,
      roughness: 0.62,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const ribbons = new THREE.Mesh(this.ribbonGeometry, this.ribbonMaterial);
    ribbons.frustumCulled = false;
    ribbons.visible = this.mode !== 'calibration';
    this.scene.add(ribbons);

    this.forwardMaterial = new THREE.MeshStandardMaterial({
      color: 0xeeeeeb,
      roughness: 0.38,
      metalness: 0.04,
    });
    this.forwardMarkers = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.055, 0.18, 5),
      this.forwardMaterial,
      snapshot.topology.organisms.length,
    );
    this.forwardMarkers.frustumCulled = false;
    this.forwardMarkers.visible = this.mode !== 'calibration';
    const up = new THREE.Vector3(0, 1, 0);
    const forward = new THREE.Vector3();
    for (let organism = 0; organism < snapshot.topology.organisms.length; organism += 1) {
      const descriptor = snapshot.topology.organisms[organism];
      if (!descriptor) continue;
      forward.fromArray(descriptor.forward).normalize();
      this.position.fromArray(descriptor.center).addScaledVector(forward, 0.24);
      this.rotation.setFromUnitVectors(up, forward);
      this.scale.setScalar(0.75);
      this.transform.compose(this.position, this.rotation, this.scale);
      this.forwardMarkers.setMatrixAt(organism, this.transform);
    }
    this.forwardMarkers.instanceMatrix.needsUpdate = true;
    this.scene.add(this.forwardMarkers);

    this.applyOrganismLook(options.look);

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
    const cameraDistance = this.camera.position.distanceTo(this.controls.target);
    this.packOptions.lod = this.fixedLod ?? selectMorphologyLod(cameraDistance, this.tier);
    const buffers = this.packer.update(snapshot, alpha, this.packOptions);

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

      const tone = buffers.nodeBaseTones[node] ?? 0.9;
      this.color.setRGB(tone, tone, tone, THREE.LinearSRGBColorSpace);
      this.nodes.setColorAt(node, this.color);

      const strength = buffers.nodeEmissionStrengths[node] ?? 0;
      this.nodeEmissionStrengths[node] = strength;
      const emission = spectralEmissionLinear(
        buffers.nodeWavelengths[node] ?? LIFE_WAVELENGTH_NM,
        strength * 3.2 * this.look.emissionScale,
      );
      this.nodeEmissionColors[offset] = emission.r;
      this.nodeEmissionColors[offset + 1] = emission.g;
      this.nodeEmissionColors[offset + 2] = emission.b;
      colorFromLinear(emission, this.color);
      this.emissionNodes.setColorAt(node, this.color);
      this.scale.setScalar(
        strength <= 0.001 ? 0 : (buffers.nodeScales[node] ?? 0) * (1.1 + strength * 0.4),
      );
      this.transform.compose(this.position, this.rotation, this.scale);
      this.emissionNodes.setMatrixAt(node, this.transform);
    }
    this.nodes.instanceMatrix.needsUpdate = true;
    if (this.nodes.instanceColor) this.nodes.instanceColor.needsUpdate = true;
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
    const faceAttribute = this.faceGeometry.getAttribute('position');
    faceAttribute.needsUpdate = true;
    this.faceGeometry.computeVertexNormals();

    this.homeEmitters?.update(snapshot.tick, alpha);
    this.calibration?.update(snapshot.tick, alpha);
    this.controls.update();
    this.postProcessor.render(1 / Math.max(1, this.tier.targetFps));
    const info = this.renderer.info.render;
    return { calls: info.calls, triangles: info.triangles, lines: info.lines, points: info.points };
  }

  setLook(look: SpectralLookProfile): void {
    this.look = look;
    this.applyOrganismLook(look);
    this.postProcessor.setLook(look);
    this.homeEmitters?.setLook(look);
    this.calibration?.setLook(look);
    this.setSpectralProbe(
      evaluateSpectralColor(
        this.debugSample.wavelengthNm,
        this.debugSample.intensity,
        look.exposure,
        undefined,
        look.outputSaturation,
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
    } else if (this.mode === 'organisms') {
      this.setOrganismCamera(this.fixedLod ?? 'mid');
      this.controls.target.set(0, 0.72, 0);
    } else {
      this.camera.position.set(5.4, 3.75, 6.2);
      this.controls.target.set(0, 1.0, 0);
    }
    this.controls.update();
  }

  private setOrganismCamera(distance: MorphologyLod): void {
    const radius = distance === 'macro' ? 3.35 : distance === 'overview' ? 8.1 : 5.35;
    this.camera.position.set(radius * 0.66, radius * 0.42, radius * 0.62);
  }

  private applyOrganismLook(look: SpectralLookProfile): void {
    const technical = look.name === 'technical';
    const ghost = look.name === 'ghost';
    this.nodeMaterial.wireframe = technical;
    this.nodeMaterial.transparent = ghost;
    this.nodeMaterial.opacity = ghost ? 0.34 : technical ? 0.86 : 1;
    this.nodeMaterial.depthWrite = !ghost;
    this.nodeMaterial.roughness = technical ? 0.72 : ghost ? 0.24 : 0.48;
    this.nodeMaterial.needsUpdate = true;

    this.edgeMaterial.color.set(technical ? 0x333339 : ghost ? 0x767680 : 0x54545a);
    this.edgeMaterial.opacity = technical ? 0.9 : ghost ? 0.38 : 0.72;
    this.edgeMaterial.needsUpdate = true;

    this.ribbonMaterial.wireframe = technical;
    this.ribbonMaterial.transparent = ghost;
    this.ribbonMaterial.opacity = ghost ? 0.2 : technical ? 0.62 : 1;
    this.ribbonMaterial.depthWrite = !ghost;
    this.ribbonMaterial.roughness = technical ? 0.8 : ghost ? 0.18 : 0.62;
    this.ribbonMaterial.needsUpdate = true;

    this.faceMaterial.wireframe = technical;
    this.faceMaterial.opacity = ghost ? 0.08 : technical ? 0.16 : 0.26;
    this.faceMaterial.depthWrite = false;
    this.faceMaterial.roughness = technical ? 0.9 : ghost ? 0.3 : 0.74;
    this.faceMaterial.needsUpdate = true;

    this.forwardMaterial.wireframe = technical;
    this.forwardMaterial.transparent = ghost;
    this.forwardMaterial.opacity = ghost ? 0.44 : 1;
    this.forwardMaterial.depthWrite = !ghost;
    this.forwardMaterial.needsUpdate = true;
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
