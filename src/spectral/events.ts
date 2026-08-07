export type SpectralEvent = 'feeding' | 'damage' | 'regeneration' | 'mutation' | 'inspection';

export interface SpectralEventGate {
  event: SpectralEvent;
  sourceId: string;
  startTick: number;
  durationTicks: number;
}

// P02 records event permission only. Wavelength conversion and tone mapping are
// intentionally deferred to P03 / decision D012.
export function isEventActive(gate: SpectralEventGate, tick: number): boolean {
  return tick >= gate.startTick && tick < gate.startTick + gate.durationTicks;
}

