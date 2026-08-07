import * as THREE from 'three';
import { spectralEmissionLinear, type Rgb } from '../spectral/color';
import { sampleSpectralEvent } from '../spectral/events';
import type { SpectralLookProfile } from '../spectral/looks';

function colorFromLinear(color: Rgb): THREE.Color {
  return new THREE.Color().setRGB(color.r, color.g, color.b, THREE.LinearSRGBColorSpace);
}

function pulseDistance(first: number, second: number): number {
  const direct = Math.abs(first - second);
  return Math.min(direct, 1 - direct);
}

function updateTravelingColors(
  attribute: THREE.BufferAttribute,
  phase: number,
  wavelengthAt: (amount: number) => number,
  intensity: number,
): void {
  const count = attribute.count;
  for (let index = 0; index < count; index += 1) {
    const amount = count <= 1 ? 0 : index / (count - 1);
    const distance = pulseDistance(amount, phase);
    const pulse = Math.exp(-(distance * distance) / 0.008);
    const color = spectralEmissionLinear(wavelengthAt(amount), intensity * pulse);
    attribute.setXYZ(index, color.r, color.g, color.b);
  }
  attribute.needsUpdate = true;
}

function makeSpectralLine(points: THREE.Vector3[]): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(points.length * 3), 3));
  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: true,
    }),
  );
}

export class HomeSpectralEmitters {
  readonly group = new THREE.Group();
  private readonly feedSourceMaterial = new THREE.MeshBasicMaterial({ toneMapped: true });
  private readonly damageSourceMaterial = new THREE.MeshBasicMaterial({ toneMapped: true });
  private readonly feedPath: THREE.Line;
  private readonly damagePath: THREE.Line;
  private look: SpectralLookProfile;

  constructor(look: SpectralLookProfile) {
    this.look = look;
    this.group.name = 'home-spectral-emitters';

    const feedSource = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.04, 0.18),
      this.feedSourceMaterial,
    );
    feedSource.position.set(2.7, 0.035, 0.55);
    feedSource.name = 'spectral-food-threshold';
    this.group.add(feedSource);

    const feedCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(2.7, 0.08, 0.55),
      new THREE.Vector3(2.05, 1.15, 0.35),
      new THREE.Vector3(1.15, 0.72, 0.2),
    );
    this.feedPath = makeSpectralLine(feedCurve.getPoints(64));
    this.feedPath.name = 'spectral-feed-transfer-path';
    this.group.add(this.feedPath);

    const damagePoints = [
      new THREE.Vector3(-3.035, 0.35, -0.6),
      new THREE.Vector3(-3.035, 0.8, -0.35),
      new THREE.Vector3(-3.035, 1.2, -0.7),
      new THREE.Vector3(-3.035, 1.6, -0.45),
    ];
    this.damagePath = makeSpectralLine(damagePoints);
    this.damagePath.name = 'spectral-damage-fault';
    this.group.add(this.damagePath);

    const damageSource = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.075, 0),
      this.damageSourceMaterial,
    );
    damageSource.position.copy(damagePoints[1] ?? new THREE.Vector3());
    damageSource.name = 'spectral-damage-contact';
    this.group.add(damageSource);
  }

  setLook(look: SpectralLookProfile): void {
    this.look = look;
  }

  update(tick: number, alpha: number): void {
    const phase = ((tick + alpha) / 96) % 1;
    const feed = sampleSpectralEvent('feeding', phase);
    const damage = sampleSpectralEvent('damage', phase * 1.7);
    const feedColor = spectralEmissionLinear(
      feed.wavelengthNm,
      2.6 * feed.intensityScale * this.look.emissionScale,
    );
    const damageColor = spectralEmissionLinear(
      damage.wavelengthNm,
      2.9 * damage.intensityScale * this.look.emissionScale,
    );
    this.feedSourceMaterial.color.copy(colorFromLinear(feedColor));
    this.damageSourceMaterial.color.copy(colorFromLinear(damageColor));

    updateTravelingColors(
      this.feedPath.geometry.getAttribute('color') as THREE.BufferAttribute,
      phase,
      (amount) => 410 + amount * 210,
      3 * this.look.emissionScale,
    );
    updateTravelingColors(
      this.damagePath.geometry.getAttribute('color') as THREE.BufferAttribute,
      1 - phase,
      (amount) => (amount < 0.2 ? 410 : 620 + amount * 80),
      3.4 * this.look.emissionScale,
    );
  }
}
