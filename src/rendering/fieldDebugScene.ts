import * as THREE from 'three';
import type { EnvironmentFieldSampler, FieldSourceRuntime } from '../fields/fieldSampler';
import { createFieldSample, type FieldGeometry } from '../fields/types';
import { geometryBounds } from '../fields/shapes';
import {
  DEATH_WAVELENGTH_NM,
  LIFE_WAVELENGTH_NM,
  spectralEmissionLinear,
  type Rgb,
} from '../spectral/color';
import type { SpectralLookProfile } from '../spectral/looks';

/** Lattice spacing used to reveal falloff, in meters. */
const LATTICE_STEP_METERS = 0.06;

/** Samples below this magnitude are not drawn. */
const LATTICE_THRESHOLD = 0.03;

/** Guard so a large authored environment cannot flood the debug buffers. */
const MAX_LATTICE_POINTS = 24_000;

/** Length of a gradient arrow at full magnitude, in meters. */
const ARROW_LENGTH_METERS = 0.09;

/** Only every nth lattice point grows an arrow, so direction stays readable. */
const ARROW_STRIDE = 6;

function proxyGeometry(geometry: FieldGeometry): THREE.BufferGeometry {
  switch (geometry.kind) {
    case 'point':
      return new THREE.OctahedronGeometry(0.02);
    case 'sphere':
      return new THREE.SphereGeometry(geometry.radiusMeters, 16, 12);
    case 'box':
      return new THREE.BoxGeometry(
        geometry.halfExtents[0] * 2,
        geometry.halfExtents[1] * 2,
        geometry.halfExtents[2] * 2,
      );
    case 'capsule': {
      const points = geometry.path.map((point) => new THREE.Vector3(point[0], point[1], point[2]));
      if (points.length < 2) return new THREE.SphereGeometry(geometry.radiusMeters, 10, 8);
      return new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points),
        Math.max(8, points.length * 6),
        Math.max(geometry.radiusMeters, 0.01),
        6,
        false,
      );
    }
    case 'plane':
      return new THREE.PlaneGeometry(geometry.halfExtents[0] * 2, geometry.halfExtents[1] * 2);
    case 'mesh': {
      const buffer = new THREE.BufferGeometry();
      buffer.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(Float32Array.from(geometry.triangles), 3),
      );
      return buffer;
    }
  }
}

function orientProxy(object: THREE.Object3D, geometry: FieldGeometry): void {
  switch (geometry.kind) {
    case 'point':
      object.position.set(...geometry.position);
      return;
    case 'sphere':
      object.position.set(...geometry.center);
      return;
    case 'box':
      object.position.set(...geometry.center);
      object.rotation.y = geometry.yawRadians ?? 0;
      return;
    case 'plane': {
      object.position.set(...geometry.center);
      const normal = new THREE.Vector3(...geometry.normal).normalize();
      object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      return;
    }
    case 'capsule':
    case 'mesh':
      return;
  }
}

/**
 * Debug rendering for the field API.
 *
 * Sign is colour (470 nm life for food, 620 nm death for kill), falloff is
 * brightness, range is how far the lattice reaches, source identity is the wire
 * proxy plus the panel legend, and sampled direction is the gradient arrow.
 * Nothing here feeds back into the simulation.
 */
export class FieldDebugScene {
  readonly group = new THREE.Group();

  private readonly proxies = new THREE.Group();
  private readonly lattice: THREE.Points;
  private readonly latticeGeometry = new THREE.BufferGeometry();
  private readonly arrows: THREE.LineSegments;
  private readonly arrowGeometry = new THREE.BufferGeometry();
  private look: SpectralLookProfile;

  constructor(
    private readonly sampler: EnvironmentFieldSampler,
    look: SpectralLookProfile,
  ) {
    this.look = look;
    this.group.name = 'field-debug';
    this.group.add(this.proxies);

    this.lattice = new THREE.Points(
      this.latticeGeometry,
      new THREE.PointsMaterial({
        size: 0.018,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: true,
      }),
    );
    this.lattice.frustumCulled = false;
    this.group.add(this.lattice);

    this.arrows = new THREE.LineSegments(
      this.arrowGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: true,
      }),
    );
    this.arrows.frustumCulled = false;
    this.group.add(this.arrows);

    this.rebuild();
  }

  /** Rebuild every proxy and lattice buffer from the current field state. */
  rebuild(): void {
    this.buildProxies();
    this.buildLattice();
  }

  private buildProxies(): void {
    for (const child of [...this.proxies.children]) {
      this.proxies.remove(child);
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    for (const source of this.sampler.sources) {
      const base = proxyGeometry(source.geometry);
      const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(base, 18),
        new THREE.LineBasicMaterial({
          color: this.proxyColor(source),
          transparent: true,
          opacity: source.strength === 0 ? 0.28 : 0.6,
        }),
      );
      orientProxy(wire, source.geometry);
      wire.name = `field-proxy:${source.id}`;
      wire.frustumCulled = false;
      this.proxies.add(wire);
      base.dispose();
    }
  }

  private proxyColor(source: FieldSourceRuntime): THREE.Color {
    if (source.strength === 0) return new THREE.Color(0x8b8b90);
    const emission = this.emission(source.strength > 0 ? 1 : -1, 0.75);
    return new THREE.Color().setRGB(emission.r, emission.g, emission.b, THREE.LinearSRGBColorSpace);
  }

  private emission(sign: number, amount: number): Rgb {
    return spectralEmissionLinear(
      sign >= 0 ? LIFE_WAVELENGTH_NM : DEATH_WAVELENGTH_NM,
      amount * 2.4 * this.look.emissionScale,
    );
  }

  private buildLattice(): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const arrowPositions: number[] = [];
    const arrowColors: number[] = [];
    const sample = createFieldSample();
    const step = LATTICE_STEP_METERS;
    let drawn = 0;

    for (const source of this.sampler.sources) {
      if (source.strength === 0 || !(source.rangeMeters > 0)) continue;
      const bounds = geometryBounds(source.geometry);
      const range = source.rangeMeters;
      // Snapping to a global lattice keeps overlapping sources from drawing two
      // slightly offset point clouds in the same volume.
      const minX = Math.floor((bounds.min[0] - range) / step) * step;
      const minY = Math.floor((bounds.min[1] - range) / step) * step;
      const minZ = Math.floor((bounds.min[2] - range) / step) * step;
      const maxX = bounds.max[0] + range;
      const maxY = bounds.max[1] + range;
      const maxZ = bounds.max[2] + range;

      for (let x = minX; x <= maxX && drawn < MAX_LATTICE_POINTS; x += step) {
        for (let y = minY; y <= maxY && drawn < MAX_LATTICE_POINTS; y += step) {
          for (let z = minZ; z <= maxZ && drawn < MAX_LATTICE_POINTS; z += step) {
            this.sampler.sample(x, y, z, sample);
            const magnitude = Math.max(sample.food, sample.kill);
            if (magnitude < LATTICE_THRESHOLD) continue;
            const sign = sample.kill > sample.food ? -1 : 1;
            const color = this.emission(sign, magnitude);
            positions.push(x, y, z);
            colors.push(color.r, color.g, color.b);

            if (drawn % ARROW_STRIDE === 0 && sample.gradientMagnitude > 0.001) {
              const length = ARROW_LENGTH_METERS * (0.35 + sample.gradientMagnitude * 0.65);
              arrowPositions.push(
                x,
                y,
                z,
                x + sample.gradientX * length,
                y + sample.gradientY * length,
                z + sample.gradientZ * length,
              );
              // Arrows point up the net-effect gradient: toward food, away from
              // kill, which is what the organism actually senses.
              arrowColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
            }
            drawn += 1;
          }
        }
      }
    }

    this.latticeGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(Float32Array.from(positions), 3),
    );
    this.latticeGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(Float32Array.from(colors), 3),
    );
    this.latticeGeometry.computeBoundingSphere();

    this.arrowGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(Float32Array.from(arrowPositions), 3),
    );
    this.arrowGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(Float32Array.from(arrowColors), 3),
    );
    this.arrowGeometry.computeBoundingSphere();
  }

  setLook(look: SpectralLookProfile): void {
    this.look = look;
    this.rebuild();
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    this.latticeGeometry.dispose();
    (this.lattice.material as THREE.Material).dispose();
    this.arrowGeometry.dispose();
    (this.arrows.material as THREE.Material).dispose();
    for (const child of this.proxies.children) {
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }
}
