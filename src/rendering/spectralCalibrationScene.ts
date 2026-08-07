import * as THREE from 'three';
import {
  evaluateSpectralColor,
  LIFE_WAVELENGTH_NM,
  SPECTRAL_CLAMP_MAX_NM,
  SPECTRAL_CLAMP_MIN_NM,
  spectralEmissionLinear,
  type SpectralColorSample,
  type Rgb,
} from '../spectral/color';
import { sampleSpectralEvent, type SpectralEvent } from '../spectral/events';
import type { SpectralLookProfile } from '../spectral/looks';

const EVENTS: SpectralEvent[] = [
  'feeding',
  'hazard',
  'damage',
  'regeneration',
  'mutation',
  'death',
];

function colorFromLinear(color: Rgb): THREE.Color {
  return new THREE.Color().setRGB(color.r, color.g, color.b, THREE.LinearSRGBColorSpace);
}

function emissiveMaterial(color: Rgb): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: colorFromLinear(color),
    toneMapped: true,
    transparent: true,
    opacity: 1,
  });
}

function plate(width: number, height: number, x: number, y: number): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.92, 0.92, 0.92, THREE.LinearSRGBColorSpace),
    roughness: 0.82,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.12), material);
  mesh.position.set(x, y, -0.08);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class SpectralCalibrationScene {
  readonly group = new THREE.Group();
  private readonly semanticMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly probeMaterial: THREE.MeshBasicMaterial;
  private readonly probe: THREE.Mesh;
  private look: SpectralLookProfile;
  private sample: SpectralColorSample;

  constructor(look: SpectralLookProfile) {
    this.look = look;
    this.sample = evaluateSpectralColor(LIFE_WAVELENGTH_NM, 2.5, look.exposure);
    this.group.name = 'spectral-calibration-scene';

    const board = plate(9.5, 5.9, 0, 0);
    board.position.z = -0.34;
    this.group.add(board);

    const wavelengthCount = 17;
    for (let index = 0; index < wavelengthCount; index += 1) {
      const amount = index / (wavelengthCount - 1);
      const wavelength = SPECTRAL_CLAMP_MIN_NM +
        amount * (SPECTRAL_CLAMP_MAX_NM - SPECTRAL_CLAMP_MIN_NM);
      const color = spectralEmissionLinear(wavelength, 2.2 * look.emissionScale);
      const swatch = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.08), emissiveMaterial(color));
      swatch.position.set(-4.05 + amount * 8.1, 2.05, 0);
      swatch.userData.wavelengthNm = wavelength;
      this.group.add(swatch);
    }

    const strengths = [0.25, 0.5, 1, 2, 4, 8];
    for (let index = 0; index < strengths.length; index += 1) {
      const intensity = strengths[index] ?? 1;
      const color = spectralEmissionLinear(LIFE_WAVELENGTH_NM, intensity * look.emissionScale);
      const sphere = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.24 + index * 0.018, 2),
        emissiveMaterial(color),
      );
      sphere.position.set(-3.35 + index * 1.32, 0.86, 0.08);
      sphere.userData.intensity = intensity;
      this.group.add(sphere);

      const neutral = plate(0.58, 0.18, -3.35 + index * 1.32, 0.33);
      const neutralMaterial = neutral.material as THREE.MeshStandardMaterial;
      const value = 0.68 + index * 0.055;
      neutralMaterial.color.setRGB(value, value, value, THREE.LinearSRGBColorSpace);
      this.group.add(neutral);
    }

    for (let index = 0; index < EVENTS.length; index += 1) {
      const event = EVENTS[index] ?? 'feeding';
      const semantic = sampleSpectralEvent(event, index / EVENTS.length);
      const material = emissiveMaterial(
        spectralEmissionLinear(
          semantic.wavelengthNm,
          semantic.intensityScale * 2.6 * look.emissionScale,
        ),
      );
      this.semanticMaterials.push(material);
      const geometry = index % 3 === 0
        ? new THREE.TorusGeometry(0.3, 0.045, 10, 48)
        : index % 3 === 1
          ? new THREE.OctahedronGeometry(0.29, 0)
          : new THREE.ConeGeometry(0.28, 0.58, 5);
      const marker = new THREE.Mesh(geometry, material);
      marker.position.set(-3.35 + index * 1.32, -0.94, 0.08);
      marker.userData.event = event;
      this.group.add(marker);
    }

    this.probeMaterial = emissiveMaterial(this.sample.linearRgb);
    this.probe = new THREE.Mesh(new THREE.TorusKnotGeometry(0.47, 0.065, 128, 16), this.probeMaterial);
    this.probe.position.set(0, -2.15, 0.12);
    this.group.add(this.probe);

    const graphite = new THREE.LineBasicMaterial({ color: 0x8b8b8a, transparent: true, opacity: 0.4 });
    for (const y of [1.54, -0.05, -1.52]) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-4.35, y, 0.02),
        new THREE.Vector3(4.35, y, 0.02),
      ]);
      this.group.add(new THREE.Line(geometry, graphite));
    }
  }

  setLook(look: SpectralLookProfile): void {
    this.look = look;
  }

  setProbe(sample: SpectralColorSample): void {
    this.sample = sample;
    this.probeMaterial.color.copy(colorFromLinear(sample.linearRgb));
  }

  update(tick: number, alpha: number): void {
    const phase = (tick + alpha) / 90;
    this.probe.rotation.x = phase * 0.65;
    this.probe.rotation.y = phase * 1.1;
    for (let index = 0; index < EVENTS.length; index += 1) {
      const event = EVENTS[index] ?? 'feeding';
      const semantic = sampleSpectralEvent(event, phase + index * 0.13);
      const color = spectralEmissionLinear(
        semantic.wavelengthNm,
        semantic.intensityScale * 2.6 * this.look.emissionScale,
      );
      this.semanticMaterials[index]?.color.copy(colorFromLinear(color));
    }
  }
}
