/**
 * Browser-side NCA checkpoint contract and deterministic CPU reference (P06a).
 *
 * Loads P05a-format checkpoints, validates them before execution, and runs them
 * on the CPU with seed/reset/pause/single-step/lesion controls. Pure typed-array
 * arithmetic — no Three.js, DOM, GPU, or network dependency. The WebGL2 path
 * follows once P05b produces real checkpoint candidates.
 */
export {
  decodeBase64,
  encodeBase64,
  expectedTensorShapes,
  loadBrowserCheckpoint,
  validateCheckpointManifest,
} from './checkpoint/loader';
export { sha256Hex } from './checkpoint/sha256';
export {
  CONTAINER_TAG,
  CheckpointValidationError,
  SUPPORTED_ARCHITECTURES,
  SUPPORTED_DTYPES,
} from './checkpoint/types';
export type {
  BrowserCheckpointContainer,
  CheckpointErrorCode,
  CheckpointManifest,
  CheckpointTensor,
  CheckpointTensorEntry,
  LoadedCheckpoint,
  SupportedArchitecture,
  SupportedDtype,
} from './checkpoint/types';
export { ReferenceRuntimeError, createReferenceRuntime } from './reference/runtime';
export type { LesionRequest, ReferenceRuntime, ReferenceRuntimeOptions } from './reference/runtime';
export { VectorNcaReferenceKernel } from './reference/vectorNcaKernel';
