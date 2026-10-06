/** Opt-in M2 graybox route (`?graybox`), kept separate so `main.ts` can import it statically. */
export const GRAYBOX_QUERY = 'graybox';

export function isGrayboxRequested(search: string): boolean {
  return new URLSearchParams(search).has(GRAYBOX_QUERY);
}

/** `?graybox=7` selects seed 7; anything else falls back to seed 1. */
export function grayboxSeed(search: string): number {
  const value = Number.parseInt(new URLSearchParams(search).get(GRAYBOX_QUERY) ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}
