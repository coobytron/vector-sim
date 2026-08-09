// Browser-only: Vite rewrites this to a hashed asset URL and emits the .wasm
// as a separate file rather than inlining it into the JS bundle.
//
// Import this module ONLY from browser entry points. Node (tests, benchmarks)
// resolves the .wasm beside the glue and needs no locateFile, so importing this
// under Node would fail on the `?url` suffix.
import joltWasmUrl from 'jolt-physics/dist/jolt-physics.wasm.wasm?url';
import type { LocateFile } from './joltLoader';

export { joltWasmUrl };

/** `locateFile` for {@link import('./joltLoader').loadJolt} under Vite. */
export const viteLocateJoltWasm: LocateFile = (path) =>
  path.endsWith('.wasm') ? joltWasmUrl : path;
