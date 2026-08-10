/**
 * Checkpoint contracts shared by the P05a training exporter and the browser
 * runtime. Field names in {@link CheckpointManifest} are snake_case because
 * they mirror `training/vector_nca/core.py::save_checkpoint` byte for byte —
 * a P05a `.manifest.json` must load without hand editing.
 */

export const SUPPORTED_ARCHITECTURES = ['vector_nca_mlp_v1'] as const;
export type SupportedArchitecture = (typeof SUPPORTED_ARCHITECTURES)[number];

export const SUPPORTED_DTYPES = ['float32'] as const;
export type SupportedDtype = (typeof SUPPORTED_DTYPES)[number];

export const CONTAINER_TAG = 'vector-nca-browser.v1';

/** The P05a manifest, exactly as `save_checkpoint` writes it. */
export interface CheckpointManifest {
  readonly schema_version: number;
  readonly architecture: string;
  readonly phenotype: string;
  readonly latent_channels: number;
  readonly sensor_channels: number;
  readonly hidden_width: number;
  /**
   * Residual rate applied as `latent + delta × update_rate`.
   *
   * Optional because checkpoints exported before this field existed omit it;
   * those fall back to the container's `updateRate`.
   */
  readonly update_rate?: number;
  readonly dtype: string;
  readonly checkpoint_version: string;
  /** SHA-256 of the source `.pt` file. Provenance only — see the container. */
  readonly sha256: string;
  readonly training_seed: number;
  readonly metrics: Readonly<Record<string, number>>;
  readonly limitations: readonly string[];
  readonly intended_use: string;
}

export interface CheckpointTensorEntry {
  /** PyTorch `state_dict` key, e.g. `net.0.weight`. */
  readonly name: string;
  /** Row-major dimensions; PyTorch `Linear.weight` is `[out, in]`. */
  readonly shape: readonly number[];
  /** Element offset into the decoded float32 payload. */
  readonly offset: number;
}

/**
 * Browser-ready weight container.
 *
 * The manifest travels verbatim; everything the browser additionally needs to
 * execute the checkpoint lives at the container level, so the training-side
 * manifest never has to grow browser-specific fields.
 */
export interface BrowserCheckpointContainer {
  readonly container: typeof CONTAINER_TAG;
  readonly manifest: CheckpointManifest;
  /**
   * Residual update rate, as a fallback for checkpoints whose manifest predates
   * `update_rate`. The manifest wins when it carries the field.
   */
  readonly updateRate?: number;
  readonly tensors: readonly CheckpointTensorEntry[];
  /** Little-endian float32 payload, base64 encoded. */
  readonly payloadBase64: string;
  /** SHA-256 of the decoded payload bytes. This is what the loader verifies. */
  readonly payloadSha256: string;
}

export interface CheckpointTensor {
  readonly name: string;
  readonly shape: readonly number[];
  readonly data: Float32Array;
}

export interface LoadedCheckpoint {
  readonly manifest: CheckpointManifest;
  readonly architecture: SupportedArchitecture;
  readonly phenotype: string;
  readonly latentChannels: number;
  readonly sensorChannels: number;
  readonly hiddenWidth: number;
  readonly updateRate: number;
  readonly tensors: Readonly<Record<string, CheckpointTensor>>;
  /** Payload checksum that was verified at load time. */
  readonly payloadSha256: string;
}

export type CheckpointErrorCode =
  | 'container'
  | 'manifest'
  | 'architecture'
  | 'dtype'
  | 'shape'
  | 'payload'
  | 'checksum'
  | 'corrupt';

export class CheckpointValidationError extends Error {
  readonly code: CheckpointErrorCode;

  constructor(code: CheckpointErrorCode, message: string) {
    super(`checkpoint ${code} error: ${message}`);
    this.name = 'CheckpointValidationError';
    this.code = code;
  }
}
