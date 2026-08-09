/**
 * WASM loading for the Jolt adapter.
 *
 * Kept separate from `joltWorld.ts` so the world stays a pure consumer of a
 * `loadJolt` callback and can be driven from Node (tests, benchmarks) or the
 * browser (Vite asset URL) without branching on environment inside the adapter.
 *
 * Single-threaded build only. The multithreaded variant needs cross-origin
 * isolation headers and is explicitly out of scope for this spike.
 */

export type LocateFile = (path: string) => string;

interface JoltInit {
  (config?: { locateFile?: LocateFile }): Promise<unknown>;
}

/**
 * Instantiates single-threaded Jolt. Node resolves the `.wasm` beside the glue
 * automatically; the browser must pass `locateFile` from `viteLocateJoltWasm`.
 */
export async function loadJolt(locateFile?: LocateFile): Promise<unknown> {
  const module = (await import('jolt-physics/wasm')) as unknown as {
    default?: JoltInit;
  } & JoltInit;
  const init = (module.default ?? module) as JoltInit;
  return locateFile === undefined ? init() : init({ locateFile });
}
