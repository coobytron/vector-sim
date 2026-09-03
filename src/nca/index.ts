/**
 * Browser-side NCA checkpoint contract and deterministic CPU/GPU runtimes.
 *
 * Loads P05-format checkpoints, validates them before execution, provides the
 * deterministic CPU reference kernel, and exposes the WebGL2 execution path.
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
export { WebGlNcaRuntime } from './webgl2Runtime';
export type { WebGlNcaRuntimeOptions, WebGlNcaTelemetry } from './webgl2Runtime';
