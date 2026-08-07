import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createHomeEnvironment } from '../environments/home';
import { effectivePixelRatio } from '../platform/capabilities';
import type { QualityTier, SimulationSnapshot } from '../simulation/types';
import { VectorBufferPacker } from './vectorBufferPacker';

export interface RenderMetrics {
  calls: number;
  triangles: number;
  lines: number;
  points: number;
}

export class VectorRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;

  private readonly nodes: THREE.InstancedMesh;
  private readonly edgeGeometry: THREE.BufferGeometry;
  private readonly ribbonGeometry: THREE.BufferGeometry;
  private readonly packer: VectorBufferPacker;
  private readonly transform = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly tier: QualityTier,
    snapshot: SimulationSnapshot,
  ) {
    this.scene.background = new THREE.Color(0xf7f7f5);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: tier.name === 'desktop',
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    this.renderer.shadowMap.enabled = tier.name === 'desktop';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera.position.set(5.4, 3.75, 6.2);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1.0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 4.0;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.update();

    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(4, 7, 5);
    key.castShadow = tier.name === 'desktop';
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc8c8c4, 2.1), key);
    this.scene.add(createHomeEnvironment());

    const nodeGeometry = new THREE.IcosahedronGeometry(0.035, 1);
    const nodeMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2f2ef,
      roughness: 0.48,
      metalness: 0.02,
    });
    this.nodes = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, snapshot.active.length);
    this.nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nodes.frustumCulled = false;
    this.scene.add(this.nodes);

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
    this.scene.add(lines);

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
    this.scene.add(ribbons);

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
    }
    this.nodes.instanceMatrix.needsUpdate = true;

    const edgeAttribute = this.edgeGeometry.getAttribute('position');
    edgeAttribute.needsUpdate = true;

    const ribbonAttribute = this.ribbonGeometry.getAttribute('position');
    ribbonAttribute.needsUpdate = true;
    this.ribbonGeometry.computeVertexNormals();

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    return { calls: info.calls, triangles: info.triangles, lines: info.lines, points: info.points };
  }

  recenter(): void {
    this.camera.position.set(5.4, 3.75, 6.2);
    this.controls.target.set(0, 1.0, 0);
    this.controls.update();
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    const dpr = effectivePixelRatio(width, height, window.devicePixelRatio, this.tier);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
