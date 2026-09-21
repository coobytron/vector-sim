import { vec3, type FieldProvider, type Vec3 } from '../environments/fields';
import { createLifecycleSystem, type LifecycleEvent, type OrganismLifecycleState } from '../lifecycle';
import { deriveOrganismPresentation, type OrganismPresentationState } from '../organisms/presentation';
import type { MorphologyTopology } from '../organisms/types';

export interface SimulationLifecycleSnapshot {
  /** Indexed by the same organism index as the morphology topology. */
  readonly states: readonly OrganismLifecycleState[];
  readonly presentations: ReadonlyMap<number, OrganismPresentationState>;
  /** Current tick only; the lifecycle state retains transition/death history. */
  readonly events: readonly LifecycleEvent[];
}

/** Connects any field provider to the existing lifecycle and presentation contracts. */
export class FieldLifecycle {
  private readonly system;
  private readonly states: OrganismLifecycleState[] = [];
  private readonly presentations = new Map<number, OrganismPresentationState>();
  readonly snapshot: SimulationLifecycleSnapshot;

  constructor(
    provider: FieldProvider,
    private readonly topology: MorphologyTopology,
    positions: Float32Array,
    active: Uint8Array,
  ) {
    this.system = createLifecycleSystem({
      provider,
      rates: { maxPopulation: topology.organisms.length },
    });
    for (let index = 0; index < topology.organisms.length; index += 1) {
      const organism = topology.organisms[index]!;
      this.system.spawn({
        id: organism.id,
        seed: organism.seed,
        phenotype: organism.family,
        position: this.centroid(index, positions, active),
      });
    }
    this.refresh();
    this.snapshot = { states: this.states, presentations: this.presentations, events: this.system.events() };
  }

  step(positions: Float32Array, active: Uint8Array): void {
    this.system.clearEvents();
    for (let index = 0; index < this.topology.organisms.length; index += 1) {
      this.system.moveTo(this.topology.organisms[index]!.id, this.centroid(index, positions, active));
    }
    this.system.step();
    this.refresh();
  }

  private refresh(): void {
    for (let index = 0; index < this.topology.organisms.length; index += 1) {
      const state = this.system.get(this.topology.organisms[index]!.id)!;
      this.states[index] = state;
      this.presentations.set(index, deriveOrganismPresentation(state, this.system.events(), this.system.tick));
    }
  }

  private centroid(index: number, positions: Float32Array, active: Uint8Array): Vec3 {
    const organism = this.topology.organisms[index]!;
    let x = 0, y = 0, z = 0, count = 0;
    for (let node = organism.start; node < organism.start + organism.count; node += 1) {
      if (active[node] !== 1) continue;
      x += positions[node * 3] ?? 0;
      y += positions[node * 3 + 1] ?? 0;
      z += positions[node * 3 + 2] ?? 0;
      count += 1;
    }
    return count > 0 ? vec3(x / count, y / count, z / count) : vec3(...organism.center);
  }
}
