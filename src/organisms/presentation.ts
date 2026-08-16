import type { FieldContact, Vec3 } from '../environments/fields';
import type {
  LifecycleEvent,
  LifecycleStatus,
  OrganismLifecycleState,
} from '../lifecycle/types';
import type { SpectralEvent } from '../spectral/events';
import type { OrganismVisualState, VisualDecodeInput } from './types';

/**
 * Lifecycle -> presentation mapping (P08b).
 *
 * The lifecycle core owns metabolism and emits a causal event log; this module
 * is the only place that turns that record into something a renderer can read.
 * It is a pure function of `(state, events, tick)`: no UI state, no wall clock,
 * no randomness, and no environment branch, so the same fixture always produces
 * the same presentation signature.
 *
 * What it deliberately does not do: invent topology. The lifecycle's repair path
 * genuinely lowers damage, so reflecting that in thickness and continuity is
 * honest, but structural regrowth — new nodes, reconnected edges — stays gated
 * on trained-NCA evidence (#31/#42). A blocked repair request shows a restrained
 * pending cue and nothing more.
 */

/** Ticks per second at the contract's fixed 30 Hz cadence. */
const TICKS_PER_SECOND = 30;

/**
 * Emission windows, in ticks, from the temporal-persistence rules in
 * `docs/ART-DIRECTION.md`: <= 0.8 s for feeding/regeneration, <= 0.35 s for
 * damage. Death gets its own longer fade because it is a terminal collapse
 * rather than a persistence tail.
 */
const FEED_WINDOW_TICKS = Math.round(0.8 * TICKS_PER_SECOND);
const DAMAGE_WINDOW_TICKS = Math.round(0.35 * TICKS_PER_SECOND);
const MUTATION_WINDOW_TICKS = Math.round(0.6 * TICKS_PER_SECOND);
const DEATH_FADE_TICKS = Math.round(1.5 * TICKS_PER_SECOND);

/**
 * A repair the organism asked for but has not earned. It reads as a held,
 * low-intensity seam rather than the full 470 nm life return.
 */
const REPAIR_PENDING_CEILING = 0.34;

/**
 * A granted, deterministic repair. Still capped below a full life return: the
 * damage genuinely fell, but learned regeneration has not been demonstrated.
 */
const REPAIR_GRANTED_CEILING = 0.68;

export interface PresentationFocus {
  /** Contributing source IDs, ascending — the lifecycle core's own ordering. */
  readonly sourceIds: readonly string[];
  /** Contact point of the strongest contributor, or `null` when uncontacted. */
  readonly point: Vec3 | null;
  /** Unit direction from the authored surface toward the sampled point. */
  readonly normal: Vec3 | null;
  /** Post-falloff contribution of that strongest contributor, `[0, 1]`. */
  readonly contribution: number;
}

export interface OrganismPresentationState {
  readonly organismId: string;
  readonly tick: number;
  readonly status: LifecycleStatus;
  /** The P04 visual vocabulary term this lifecycle status renders as. */
  readonly visualState: OrganismVisualState;
  /** Spectral event permitted this tick, or `null` for white rest. */
  readonly emissionEvent: SpectralEvent | null;
  /**
   * Monotonic `[0, 1]` since the driving transition. Clamped, never wrapped, so
   * a terminal fade runs once instead of re-igniting on a loop.
   */
  readonly eventPhase: number;
  /** Upper bound on emission strength for states that have not earned full intensity. */
  readonly emissionCeiling: number;
  readonly energy: number;
  readonly damage: number;
  readonly viability: number;
  /** Structural thickness support, `[0, 1]`. */
  readonly thicknessScale: number;
  /** Per-organism opacity, `[0, 1]`. */
  readonly opacity: number;
  /** Connection continuity; drops as damage fractures the graph. */
  readonly continuity: number;
  /** How long motion history persists behind the organism, `[0, 1]`. */
  readonly trailPersistence: number;
  /** A repair was requested this tick but not granted. */
  readonly repairPending: boolean;
  /** Why the repair was refused — `energy`, `danger`, ascending. */
  readonly repairBlockedBy: readonly string[];
  /** Where intake came from this tick. */
  readonly feedFocus: PresentationFocus | null;
  /** Where damage landed this tick. */
  readonly damageFocus: PresentationFocus | null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * Strongest contributor wins; ties break on ascending source ID so the focus is
 * stable for a given tick regardless of contact ordering.
 */
function focusFromContacts(
  sourceIds: readonly string[],
  contacts: readonly FieldContact[],
): PresentationFocus {
  let best: FieldContact | null = null;
  for (const contact of contacts) {
    if (best === null) {
      best = contact;
      continue;
    }
    if (contact.contribution > best.contribution) {
      best = contact;
      continue;
    }
    if (contact.contribution === best.contribution && contact.sourceId < best.sourceId) {
      best = contact;
    }
  }
  return {
    sourceIds,
    point: best?.point ?? null,
    normal: best?.normal ?? null,
    contribution: best?.contribution ?? 0,
  };
}

/**
 * Lifecycle statuses are metabolic; the P04 vocabulary is visual. `thriving`
 * only reads as feeding while intake is actually arriving — otherwise a
 * well-fed organism at rest would glow blue forever, which the art direction
 * reserves for an actual transfer.
 */
function visualStateFor(
  status: LifecycleStatus,
  intaking: boolean,
  repairGranted: boolean,
): OrganismVisualState {
  switch (status) {
    case 'dead':
      return 'death';
    case 'dying':
      return 'dying';
    case 'stressed':
      return 'damaged';
    case 'repairing':
      return repairGranted ? 'regenerating' : 'damaged';
    case 'thriving':
      return intaking ? 'feeding' : 'dormant';
    case 'resting':
      return intaking ? 'feeding' : 'dormant';
    case 'searching':
      // Below resting energy and looking for a source: the visual vocabulary's
      // nearest term is starving, which reduces thickness and ribbon weight.
      return intaking ? 'feeding' : 'starving';
  }
}

function emissionEventFor(state: OrganismVisualState): SpectralEvent | null {
  switch (state) {
    case 'feeding':
      return 'feeding';
    case 'damaged':
    case 'dying':
      return 'damage';
    case 'mutating':
      return 'mutation';
    case 'death':
      return 'death';
    case 'regenerating':
      return 'regeneration';
    case 'dormant':
    case 'starving':
      return null;
  }
}

function eventWindowTicks(state: OrganismVisualState): number {
  switch (state) {
    case 'death':
      return DEATH_FADE_TICKS;
    case 'damaged':
    case 'dying':
      return DAMAGE_WINDOW_TICKS;
    case 'mutating':
      return MUTATION_WINDOW_TICKS;
    case 'feeding':
    case 'regenerating':
      return FEED_WINDOW_TICKS;
    case 'dormant':
    case 'starving':
      return FEED_WINDOW_TICKS;
  }
}

/**
 * Trail persistence follows the state-through-motion contract in #5: confident
 * history behind a thriving organism, probing arcs while searching, fragmented
 * history under damage, and evaporation at death.
 */
function trailPersistenceFor(state: OrganismVisualState, viability: number): number {
  switch (state) {
    case 'feeding':
      return clamp01(0.72 + viability * 0.24);
    case 'regenerating':
      return clamp01(0.5 + viability * 0.22);
    case 'dormant':
      return clamp01(0.34 + viability * 0.12);
    case 'starving':
      return clamp01(0.46 + viability * 0.14);
    case 'damaged':
      return clamp01(0.2 + viability * 0.18);
    case 'mutating':
      return clamp01(0.4 + viability * 0.2);
    case 'dying':
      return clamp01(0.06 + viability * 0.1);
    case 'death':
      return 0;
  }
}

/**
 * Derives the renderer-facing presentation state for one organism on one tick.
 *
 * `events` may be the whole retained log; only entries for this organism on
 * this tick contribute, so callers can pass `system.events()` unfiltered.
 *
 * There is no rate table here on purpose: the lifecycle core already applied it
 * when it resolved `status`, so re-reading thresholds would give the renderer a
 * second, drifting copy of the metabolic contract.
 */
export function deriveOrganismPresentation(
  organism: OrganismLifecycleState,
  events: readonly LifecycleEvent[],
  tick: number,
): OrganismPresentationState {
  let intaking = false;
  let repairGranted = false;
  let repairPending = false;
  let repairBlockedBy: readonly string[] = [];
  let feedFocus: PresentationFocus | null = null;
  let damageFocus: PresentationFocus | null = null;

  for (const event of events) {
    if (event.organismId !== organism.id || event.tick !== tick) continue;
    switch (event.kind) {
      case 'intake':
        if (event.amount > 0) {
          intaking = true;
          feedFocus = focusFromContacts(event.sourceIds, event.contacts);
        }
        break;
      case 'damage':
        if (event.amount > 0) {
          damageFocus = focusFromContacts(event.sourceIds, event.contacts);
        }
        break;
      case 'lesion':
        if (event.amount > 0 && damageFocus === null) {
          damageFocus = focusFromContacts(event.sourceIds, event.contacts);
        }
        break;
      case 'repair-request':
        if (event.granted) {
          repairGranted = true;
        } else {
          repairPending = true;
          repairBlockedBy = event.blockedBy;
        }
        break;
      case 'spawn':
      case 'repair':
      case 'transition':
      case 'death':
      case 'respawn':
        break;
    }
  }

  const visualState = visualStateFor(organism.status, intaking, repairGranted);
  const emissionEvent = emissionEventFor(visualState);
  const viability = clamp01(organism.viability);
  const energy = clamp01(organism.energy);

  // Anchored to the transition that produced the current status, so the fade is
  // a property of the organism's own history rather than the global tick.
  const elapsed = Math.max(0, tick - organism.statusSinceTick);
  const eventPhase = clamp01(elapsed / Math.max(1, eventWindowTicks(visualState)));

  // Terminal states are never muted: an organism that asked for repair on the
  // tick it died still owns the full 620 nm fade. The ceiling exists to hold
  // back unearned *recovery*, not to soften damage or death.
  const terminal = visualState === 'death' || visualState === 'dying';
  const emissionCeiling = terminal
    ? 1
    : repairPending
      ? REPAIR_PENDING_CEILING
      : visualState === 'regenerating'
        ? REPAIR_GRANTED_CEILING
        : 1;

  const continuity = visualState === 'death'
    ? 0.08
    : clamp01(0.22 + viability * 0.78) * (damageFocus === null ? 1 : 0.88);

  return {
    organismId: organism.id,
    tick,
    status: organism.status,
    visualState,
    emissionEvent,
    eventPhase,
    emissionCeiling,
    energy,
    damage: clamp01(organism.damage),
    viability,
    thicknessScale: clamp01(0.34 + viability * 0.46 + energy * 0.2),
    opacity: visualState === 'death' ? clamp01(0.3 * (1 - eventPhase)) : clamp01(0.55 + viability * 0.45),
    continuity,
    trailPersistence: trailPersistenceFor(visualState, viability),
    repairPending,
    repairBlockedBy,
    feedFocus,
    damageFocus,
  };
}

/**
 * Bridges a presentation state onto the existing per-cell decode hook.
 *
 * The decoder keeps owning geometry: this only supplies the organism-level
 * facts — which state is authoritative, how far into its window it is, and how
 * much emission it has earned — and leaves per-node role, activity, and the NCA
 * channels untouched. That boundary is what lets #31/#42 replace the latent
 * channels later without touching lifecycle contracts.
 */
export function applyPresentationToDecodeInput(
  presentation: OrganismPresentationState,
  input: VisualDecodeInput,
): VisualDecodeInput {
  input.stateOverride = presentation.visualState;
  input.phase = presentation.eventPhase;
  input.emissionCeiling = presentation.emissionCeiling;
  input.energy = presentation.energy;
  input.health = presentation.viability;
  // The visual state is already authoritative here, so previousHealth only
  // needs to stay consistent with the direction the organism is moving.
  input.previousHealth = presentation.visualState === 'regenerating'
    ? Math.max(0, presentation.viability - 0.01)
    : presentation.viability;
  return input;
}

/**
 * Compact, stable description of a presentation state.
 *
 * Fixtures assert on this rather than on a float-by-float comparison, so a
 * deliberate retune shows up as one readable diff instead of twelve.
 */
export function presentationSignature(state: OrganismPresentationState): string {
  const round = (value: number) => value.toFixed(3);
  const focus = (value: PresentationFocus | null) =>
    value === null ? '-' : `${value.sourceIds.join('+') || '-'}@${round(value.contribution)}`;
  return [
    state.organismId,
    state.status,
    state.visualState,
    state.emissionEvent ?? 'none',
    `phase=${round(state.eventPhase)}`,
    `ceiling=${round(state.emissionCeiling)}`,
    `thickness=${round(state.thicknessScale)}`,
    `opacity=${round(state.opacity)}`,
    `continuity=${round(state.continuity)}`,
    `trail=${round(state.trailPersistence)}`,
    `feed=${focus(state.feedFocus)}`,
    `damage=${focus(state.damageFocus)}`,
    state.repairPending ? `pending=${state.repairBlockedBy.join('+')}` : 'pending=-',
  ].join(' ');
}
