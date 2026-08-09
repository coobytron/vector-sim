/**
 * The opt-in flag, kept in its own module so `main.ts` can test it with a
 * static import while the spike route itself stays fully dynamic. Importing
 * both statically and dynamically from one module defeats the code split and
 * drags the route into the default bundle.
 */
export const JOLT_SPIKE_QUERY = 'spike';
export const JOLT_SPIKE_VALUE = 'jolt';

export function isJoltSpikeRequested(search: string): boolean {
  return new URLSearchParams(search).get(JOLT_SPIKE_QUERY) === JOLT_SPIKE_VALUE;
}
