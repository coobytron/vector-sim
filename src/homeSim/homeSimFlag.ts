/** Opt-in M3 route (`?ncaHome` or `?ncaHome=<seed>`), kept separate so `main.ts` can import it statically. */
export const NCA_HOME_QUERY = 'ncaHome';

export function isNcaHomeRequested(search: string): boolean {
  return new URLSearchParams(search).has(NCA_HOME_QUERY);
}

export function ncaHomeSeed(search: string): number {
  const value = Number.parseInt(new URLSearchParams(search).get(NCA_HOME_QUERY) ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}
