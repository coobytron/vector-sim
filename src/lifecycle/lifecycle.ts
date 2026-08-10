import { f32, vec3 } from '../environments/fields';
import type { FieldProvider, Vec3 } from '../environments/fields';
import { resolveLifecycleRates } from './rates';
import { LifecycleValidationError } from './types';
import type {
  DeathCause,
  LifecycleEvent,
  LifecycleEventDraft,
  LifecycleFieldSample,
  LifecycleRates,
  LifecycleStatus,
  OrganismLifecycleState,
} from './types';

/** Fixed simulation cadence from `docs/SIMULATION-CONTRACT.md`. */
export const LIFECYCLE_TICK_SECONDS = 1 / 30;

export interface SpawnRequest {
  readonly id: string;
  readonly position: Vec3;
  readonly seed: number;
  readonly phenotype?: string;
  readonly generation?: number;
  readonly energy?: number;
  readonly damage?: number;
}

export interface LifecycleSystemOptions {
  readonly provider: FieldProvider;
  readonly rates?: Partial<LifecycleRates>;
  /** Seconds per tick. Defaults to the contract's 30 Hz. */
  readonly tickSeconds?: number;
  /** Cap on retained events; the oldest are dropped first. Default 4096. */
  readonly maxEvents?: number;
}

export interface LifecycleSystem {
  readonly rates: LifecycleRates;
  readonly tick: number;
  readonly timeSeconds: number;
  /** Live organisms in stable ascending ID order, including the dead. */
  organisms(): readonly OrganismLifecycleState[];
  get(id: string): OrganismLifecycleState | undefined;
  /** Count of organisms that are not yet dead. */
  livingCount(): number;
  spawn(request: SpawnRequest): OrganismLifecycleState;
  /** Advances one tick for every organism, in ascending ID order. */
  step(): number;
  /** Applies external structural damage — a lesion — outside the field path. */
  applyLesion(id: string, amount: number, reason?: string): OrganismLifecycleState;
  /** Moves an organism; the next tick samples the new position. */
  moveTo(id: string, position: Vec3): OrganismLifecycleState;
  /**
   * The only way out of `dead`. Death is otherwise terminal, so a respawn is
   * always an explicit, logged policy decision.
   */
  respawn(id: string, options?: { readonly energy?: number; readonly seed?: number }): OrganismLifecycleState;
  events(): readonly LifecycleEvent[];
  clearEvents(): void;
}

function clamp01(value: number): number {
  return f32(Math.min(1, Math.max(0, value)));
}

function readChannel(scalars: Readonly<Record<string, number>>, id: string): number {
  const value = scalars[id];
  return typeof value === 'number' && Number.isFinite(value) ? clamp01(value) : 0;
}

/** Float32-quantized copy, so a caller's mutable vector cannot leak in. */
function toVec3(value: Vec3): Vec3 {
  return vec3(value.x, value.y, value.z);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Renderer-independent lifecycle core.
 *
 * Converts generic `energy` and `danger` provider channels into energy,
 * damage, viability, status, and a causal event log. It consumes the shared
 * `FieldProvider` only, so there is no Home/Forest/Pond branch anywhere in it —
 * an environment is just a different provider.
 *
 * Nothing here decodes geometry or emission, and nothing fakes learned
 * regeneration: repair is exposed as request/grant state and events for the
 * later NCA integration to drive.
 */
export function createLifecycleSystem(options: LifecycleSystemOptions): LifecycleSystem {
  const rates = resolveLifecycleRates(options.rates);
  const tickSeconds = f32(options.tickSeconds ?? LIFECYCLE_TICK_SECONDS);
  const maxEvents = options.maxEvents ?? 4096;

  if (!(tickSeconds > 0) || !Number.isFinite(tickSeconds)) {
    throw new LifecycleValidationError(`tickSeconds must be finite and > 0 (got ${tickSeconds})`);
  }
  if (!Number.isInteger(maxEvents) || maxEvents <= 0) {
    throw new LifecycleValidationError(`maxEvents must be a positive integer (got ${maxEvents})`);
  }

  interface MutableOrganism {
    id: string;
    seed: number;
    phenotype: string;
    generation: number;
    position: Vec3;
    ageSeconds: number;
    energy: number;
    intakeRate: number;
    expenditureRate: number;
    damage: number;
    status: LifecycleStatus;
    statusSinceTick: number;
    starvedSeconds: number;
    sample: LifecycleFieldSample;
    deathCause: DeathCause | null;
  }

  const organisms = new Map<string, MutableOrganism>();
  const log: LifecycleEvent[] = [];
  let tick = 0;
  let timeSeconds = 0;

  function record(organism: MutableOrganism, event: LifecycleEventDraft): void {
    log.push({
      tick,
      timeSeconds,
      organismId: organism.id,
      sourceIds: event.sourceIds ?? [],
      contacts: event.contacts ?? [],
      ...event,
    } as LifecycleEvent);
    if (log.length > maxEvents) {
      log.splice(0, log.length - maxEvents);
    }
  }

  function snapshot(organism: MutableOrganism): OrganismLifecycleState {
    return Object.freeze({
      id: organism.id,
      seed: organism.seed,
      phenotype: organism.phenotype,
      generation: organism.generation,
      position: organism.position,
      ageSeconds: organism.ageSeconds,
      energy: organism.energy,
      intakeRate: organism.intakeRate,
      expenditureRate: organism.expenditureRate,
      damage: organism.damage,
      viability: f32(1 - organism.damage),
      status: organism.status,
      statusSinceTick: organism.statusSinceTick,
      starvedSeconds: organism.starvedSeconds,
      sample: organism.sample,
      deathCause: organism.deathCause,
    });
  }

  function mustGet(id: string): MutableOrganism {
    const organism = organisms.get(id);
    if (organism === undefined) {
      throw new LifecycleValidationError(`unknown organism ${id}`);
    }
    return organism;
  }

  /**
   * Fixed-priority status resolver. The order is total and data-independent, so
   * two runs with the same inputs always agree on the label.
   */
  function resolveStatus(organism: MutableOrganism, repairing: boolean): LifecycleStatus {
    if (organism.deathCause !== null) {
      return 'dead';
    }
    if (f32(1 - organism.damage) < rates.dyingViability) {
      return 'dying';
    }
    if (organism.sample.danger >= rates.stressedDanger) {
      return 'stressed';
    }
    if (repairing) {
      return 'repairing';
    }
    if (organism.energy >= rates.thrivingEnergy) {
      return 'thriving';
    }
    if (organism.energy >= rates.restingEnergy) {
      return 'resting';
    }
    return 'searching';
  }

  function transition(organism: MutableOrganism, next: LifecycleStatus): void {
    if (organism.status === next) {
      return;
    }
    const from = organism.status;
    organism.status = next;
    organism.statusSinceTick = tick;
    record(organism, {
      kind: 'transition',
      from,
      to: next,
      sourceIds: organism.sample.sourceIds,
      contacts: organism.sample.contacts,
    });
  }

  function die(organism: MutableOrganism, cause: DeathCause): void {
    organism.deathCause = cause;
    organism.intakeRate = 0;
    organism.expenditureRate = 0;
    transition(organism, 'dead');
    record(organism, {
      kind: 'death',
      cause,
      sourceIds: organism.sample.sourceIds,
      contacts: organism.sample.contacts,
    });
  }

  function advance(organism: MutableOrganism): void {
    if (organism.deathCause !== null) {
      return;
    }

    const sampled = options.provider.sample(organism.position, timeSeconds);
    const sample: LifecycleFieldSample = {
      energy: readChannel(sampled.scalars, 'energy'),
      danger: readChannel(sampled.scalars, 'danger'),
      sourceIds: sampled.sourceIds,
      contacts: sampled.contacts,
    };
    organism.sample = sample;
    organism.ageSeconds = f32(organism.ageSeconds + tickSeconds);

    // Feeding and drain. Intake and expenditure are reported as rates so a
    // later renderer can show the balance without recomputing it.
    const intake = f32(rates.intakePerEnergyUnit * sample.energy);
    const expenditure = rates.idleDrainPerSecond;
    organism.intakeRate = intake;
    organism.expenditureRate = expenditure;

    const energyBefore = organism.energy;
    organism.energy = clamp01(f32(energyBefore + f32(f32(intake - expenditure) * tickSeconds)));
    const gained = f32(organism.energy - energyBefore);
    if (intake > 0) {
      record(organism, {
        kind: 'intake',
        amount: gained,
        channelValue: sample.energy,
        sourceIds: sample.sourceIds,
        contacts: sample.contacts,
      });
    }

    // Damage. Kill never cancels against food; the two integrate separately.
    if (sample.danger > 0) {
      const damageAmount = f32(f32(rates.damagePerDangerUnit * sample.danger) * tickSeconds);
      organism.damage = clamp01(f32(organism.damage + damageAmount));
      record(organism, {
        kind: 'damage',
        amount: damageAmount,
        channelValue: sample.danger,
        sourceIds: sample.sourceIds,
        contacts: sample.contacts,
      });
    }

    // Repair is requested whenever there is damage; whether it is granted is a
    // deterministic function of energy and danger. The NCA gate lands later and
    // will consume these events rather than replace them.
    let repairing = false;
    if (organism.damage > 0) {
      const blockedBy: string[] = [];
      if (!(organism.energy > rates.repairEnergyThreshold)) {
        blockedBy.push('energy');
      }
      if (!(organism.sample.danger < rates.repairDangerCeiling)) {
        blockedBy.push('danger');
      }
      const granted = blockedBy.length === 0;
      const requested = f32(rates.repairPerSecond * tickSeconds);

      record(organism, {
        kind: 'repair-request',
        requested,
        granted,
        blockedBy,
        sourceIds: sample.sourceIds,
        contacts: sample.contacts,
      });

      if (granted) {
        const before = organism.damage;
        organism.damage = clamp01(f32(before - requested));
        const repaired = f32(before - organism.damage);
        if (repaired > 0) {
          repairing = true;
          record(organism, { kind: 'repair', amount: repaired });
        }
      }
    }

    organism.starvedSeconds =
      organism.energy <= 0 ? f32(organism.starvedSeconds + tickSeconds) : 0;

    // Death checks run in a fixed order so the recorded cause is deterministic
    // when both thresholds are crossed on the same tick.
    if (organism.damage >= 1) {
      die(organism, 'damage');
      return;
    }
    if (rates.starvationSeconds !== null && organism.starvedSeconds >= rates.starvationSeconds) {
      die(organism, 'starvation');
      return;
    }

    transition(organism, resolveStatus(organism, repairing));
  }

  return {
    rates,
    get tick() {
      return tick;
    },
    get timeSeconds() {
      return timeSeconds;
    },
    organisms() {
      return [...organisms.values()]
        .sort((a, b) => compareText(a.id, b.id))
        .map((organism) => snapshot(organism));
    },
    get(id: string) {
      const organism = organisms.get(id);
      return organism === undefined ? undefined : snapshot(organism);
    },
    livingCount() {
      let count = 0;
      for (const organism of organisms.values()) {
        if (organism.deathCause === null) {
          count += 1;
        }
      }
      return count;
    },
    spawn(request: SpawnRequest) {
      if (!request.id) {
        throw new LifecycleValidationError('spawn requires a non-empty id');
      }
      if (organisms.has(request.id)) {
        throw new LifecycleValidationError(`organism ${request.id} already exists`);
      }
      let living = 0;
      for (const organism of organisms.values()) {
        if (organism.deathCause === null) {
          living += 1;
        }
      }
      if (living >= rates.maxPopulation) {
        throw new LifecycleValidationError(
          `population cap ${rates.maxPopulation} reached; cannot spawn ${request.id}`,
        );
      }

      const energy = request.energy ?? 0.65;
      const damage = request.damage ?? 0;
      if (!(energy >= 0 && energy <= 1)) {
        throw new LifecycleValidationError(`spawn energy must be within [0, 1] (got ${energy})`);
      }
      if (!(damage >= 0 && damage <= 1)) {
        throw new LifecycleValidationError(`spawn damage must be within [0, 1] (got ${damage})`);
      }

      const organism: MutableOrganism = {
        id: request.id,
        seed: request.seed,
        phenotype: request.phenotype ?? 'branching',
        generation: request.generation ?? 0,
        position: toVec3(request.position),
        ageSeconds: 0,
        energy: f32(energy),
        intakeRate: 0,
        expenditureRate: 0,
        damage: f32(damage),
        status: 'searching',
        statusSinceTick: tick,
        starvedSeconds: 0,
        sample: { energy: 0, danger: 0, sourceIds: [], contacts: [] },
        deathCause: null,
      };
      organisms.set(organism.id, organism);

      record(organism, {
        kind: 'spawn',
        phenotype: organism.phenotype,
        generation: organism.generation,
      });
      transition(organism, resolveStatus(organism, false));
      return snapshot(organism);
    },
    step() {
      tick += 1;
      timeSeconds = f32(timeSeconds + tickSeconds);
      // Ascending ID order: organisms never interact in this slice, but the
      // event log order has to be reproducible.
      for (const id of [...organisms.keys()].sort(compareText)) {
        advance(mustGet(id));
      }
      return tick;
    },
    applyLesion(id: string, amount: number, reason = 'external') {
      const organism = mustGet(id);
      if (!(amount >= 0 && amount <= 1)) {
        throw new LifecycleValidationError(`lesion amount must be within [0, 1] (got ${amount})`);
      }
      if (organism.deathCause !== null) {
        throw new LifecycleValidationError(`organism ${id} is dead and cannot be lesioned`);
      }

      organism.damage = clamp01(f32(organism.damage + amount));
      record(organism, { kind: 'lesion', amount: f32(amount), reason });

      if (organism.damage >= 1) {
        die(organism, 'damage');
      } else {
        transition(organism, resolveStatus(organism, false));
      }
      return snapshot(organism);
    },
    moveTo(id: string, position: Vec3) {
      const organism = mustGet(id);
      organism.position = toVec3(position);
      return snapshot(organism);
    },
    respawn(id: string, respawnOptions = {}) {
      const organism = mustGet(id);
      if (organism.deathCause === null) {
        throw new LifecycleValidationError(`organism ${id} is alive; respawn applies to the dead`);
      }

      organism.deathCause = null;
      organism.generation += 1;
      organism.seed = respawnOptions.seed ?? organism.seed;
      organism.energy = f32(respawnOptions.energy ?? 0.65);
      organism.damage = 0;
      organism.ageSeconds = 0;
      organism.starvedSeconds = 0;
      organism.intakeRate = 0;
      organism.expenditureRate = 0;
      organism.status = 'dead';

      record(organism, { kind: 'respawn', generation: organism.generation });
      transition(organism, resolveStatus(organism, false));
      return snapshot(organism);
    },
    events() {
      return log;
    },
    clearEvents() {
      log.length = 0;
    },
  };
}
