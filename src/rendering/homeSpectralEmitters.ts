import * as THREE from 'three';
import type { PresentationFocus } from '../organisms/presentation';
import type { SimulationLifecycleSnapshot } from '../simulation/fieldLifecycle';
import { spectralEmissionLinear } from '../spectral/color';
import { sampleSpectralEvent } from '../spectral/events';
import type { SpectralLookProfile } from '../spectral/looks';
import type { Vec3 } from '../environments/fields';

/** Pooled contact-to-organism cues. Only real lifecycle intake/damage can light them. */
export class HomeSpectralEmitters {
  readonly group = new THREE.Group();
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();

  constructor(private look: SpectralLookProfile, private readonly capacity: number) {
    this.positions = new Float32Array(capacity * 2 * 2 * 3);
    this.colors = new Float32Array(this.positions.length);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(this.geometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: true,
    }));
    lines.frustumCulled = false;
    lines.name = 'lifecycle-contact-transfers';
    this.group.name = 'home-spectral-emitters';
    this.group.visible = false;
    this.group.add(lines);
  }

  setLook(look: SpectralLookProfile): void {
    this.look = look;
  }

  update(lifecycle: SimulationLifecycleSnapshot | undefined): void {
    this.positions.fill(0);
    this.colors.fill(0);
    let visible = false;
    if (lifecycle) {
      for (let index = 0; index < Math.min(this.capacity, lifecycle.states.length); index += 1) {
        const state = lifecycle.states[index]!;
        const presentation = lifecycle.presentations.get(index);
        if (!presentation || state.status === 'dead') continue;
        visible = this.write(index * 12, presentation.feedFocus, state.position, 'feeding', presentation.eventPhase, presentation.emissionCeiling) || visible;
        visible = this.write(index * 12 + 6, presentation.damageFocus, state.position, 'damage', presentation.eventPhase, presentation.emissionCeiling) || visible;
      }
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
    this.group.visible = visible;
  }

  private write(offset: number, focus: PresentationFocus | null, target: Vec3, event: 'feeding' | 'damage', phase: number, ceiling: number): boolean {
    if (!focus?.point || focus.contribution <= 0 || ceiling <= 0) return false;
    const sample = sampleSpectralEvent(event, phase);
    const color = spectralEmissionLinear(sample.wavelengthNm,
      3 * sample.intensityScale * focus.contribution * ceiling * this.look.emissionScale);
    this.positions[offset] = focus.point.x;
    this.positions[offset + 1] = focus.point.y;
    this.positions[offset + 2] = focus.point.z;
    this.positions[offset + 3] = target.x;
    this.positions[offset + 4] = target.y;
    this.positions[offset + 5] = target.z;
    for (let vertex = 0; vertex < 2; vertex += 1) {
      this.colors[offset + vertex * 3] = color.r;
      this.colors[offset + vertex * 3 + 1] = color.g;
      this.colors[offset + vertex * 3 + 2] = color.b;
    }
    return true;
  }
}
