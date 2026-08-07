export type SpectralEvent =
  | 'feeding'
  | 'hazard'
  | 'damage'
  | 'regeneration'
  | 'mutation'
  | 'death'
  | 'inspection';

export type SpectralMotion =
  | 'source-to-agent'
  | 'boundary-hold'
  | 'contact-to-graph'
  | 'survivor-to-growth'
  | 'subgraph-pulse'
  | 'collapse-to-source'
  | 'channel-band';

export interface SemanticSpectralSample {
  event: SpectralEvent;
  wavelengthNm: number;
  accentWavelengthNm?: number;
  intensityScale: number;
  motion: SpectralMotion;
  formCue: string;
}

export interface SpectralEventGate {
  event: SpectralEvent;
  sourceId: string;
  startTick: number;
  durationTicks: number;
}

export function isEventActive(gate: SpectralEventGate, tick: number): boolean {
  return tick >= gate.startTick && tick < gate.startTick + gate.durationTicks;
}

function wrap01(value: number): number {
  const wrapped = value - Math.floor(value);
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function sweep(start: number, end: number, phase: number): number {
  return start + (end - start) * wrap01(phase);
}

/**
 * Semantic wavelengths are deliberately coupled to motion and form. Hue alone
 * is never the only way to distinguish a state.
 */
export function sampleSpectralEvent(
  event: SpectralEvent,
  phase: number,
): SemanticSpectralSample {
  const amount = wrap01(phase);
  switch (event) {
    case 'feeding':
      return {
        event,
        wavelengthNm: sweep(410, 620, amount),
        intensityScale: 0.72 + Math.sin(amount * Math.PI) * 0.28,
        motion: 'source-to-agent',
        formCue: 'directed transfer wave',
      };
    case 'hazard':
      return {
        event,
        wavelengthNm: 610 + Math.sin(amount * Math.PI * 2) * 18,
        intensityScale: 0.48 + Math.sin(amount * Math.PI) * 0.16,
        motion: 'boundary-hold',
        formCue: 'stationary boundary tension',
      };
    case 'damage':
      return {
        event,
        wavelengthNm: sweep(700, 620, amount),
        accentWavelengthNm: amount < 0.18 ? 410 : undefined,
        intensityScale: 1 - amount * 0.45,
        motion: 'contact-to-graph',
        formCue: 'fracture and recoil',
      };
    case 'regeneration':
      return {
        event,
        wavelengthNm: sweep(430, 590, amount),
        intensityScale: 0.62 + Math.sin(amount * Math.PI) * 0.38,
        motion: 'survivor-to-growth',
        formCue: 'outward topology reconstruction',
      };
    case 'mutation':
      return {
        event,
        wavelengthNm: sweep(380, 700, amount),
        intensityScale: Math.sin(amount * Math.PI),
        motion: 'subgraph-pulse',
        formCue: 'single restrained topology pulse',
      };
    case 'death':
      return {
        event,
        wavelengthNm: sweep(700, 665, amount),
        accentWavelengthNm: amount < 0.12 ? 400 : undefined,
        intensityScale: Math.pow(1 - amount, 1.6),
        motion: 'collapse-to-source',
        formCue: 'edge retraction and node extinction',
      };
    case 'inspection':
      return {
        event,
        wavelengthNm: sweep(440, 610, amount),
        intensityScale: 0.24,
        motion: 'channel-band',
        formCue: 'static diagnostic band',
      };
  }
}
