import { sha256Hex } from './sha256';
import {
  CONTAINER_TAG,
  CheckpointValidationError,
  SUPPORTED_ARCHITECTURES,
  SUPPORTED_DTYPES,
} from './types';
import type {
  BrowserCheckpointContainer,
  CheckpointManifest,
  CheckpointTensor,
  LoadedCheckpoint,
  SupportedArchitecture,
} from './types';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 decode without `atob`/`Buffer`, so Node and the browser agree. */
export function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/\s+/g, '');
  const withoutPadding = clean.replace(/=+$/, '');
  for (const character of withoutPadding) {
    if (!BASE64_ALPHABET.includes(character)) {
      throw new CheckpointValidationError('payload', `payloadBase64 has invalid character ${character}`);
    }
  }
  if (clean.length % 4 !== 0) {
    throw new CheckpointValidationError('payload', 'payloadBase64 length is not a multiple of four');
  }

  const bytes = new Uint8Array((withoutPadding.length * 3) >> 2);
  let byteIndex = 0;
  let accumulator = 0;
  let bits = 0;
  for (const character of withoutPadding) {
    accumulator = (accumulator << 6) | BASE64_ALPHABET.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex] = (accumulator >> bits) & 0xff;
      byteIndex += 1;
    }
  }
  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] as number;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    output += BASE64_ALPHABET[a >> 2];
    output += BASE64_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    output += b === undefined ? '=' : BASE64_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    output += c === undefined ? '=' : BASE64_ALPHABET[c & 63];
  }
  return output;
}

function requireNumber(manifest: Record<string, unknown>, field: string): number {
  const value = manifest[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CheckpointValidationError('manifest', `${field} must be a finite number`);
  }
  return value;
}

function requirePositiveInteger(manifest: Record<string, unknown>, field: string): number {
  const value = requireNumber(manifest, field);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CheckpointValidationError('manifest', `${field} must be a positive integer (got ${value})`);
  }
  return value;
}

function requireString(manifest: Record<string, unknown>, field: string): string {
  const value = manifest[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CheckpointValidationError('manifest', `${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Validates a P05a `.manifest.json` payload. Accepts the file exactly as
 * `save_checkpoint` writes it; unknown extra fields are preserved, not rejected,
 * so P05b can add metadata without breaking the runtime.
 */
export function validateCheckpointManifest(candidate: unknown): CheckpointManifest {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new CheckpointValidationError('manifest', 'manifest must be an object');
  }
  const manifest = candidate as Record<string, unknown>;

  const schemaVersion = requireNumber(manifest, 'schema_version');
  if (schemaVersion !== 1) {
    throw new CheckpointValidationError('manifest', `unsupported schema_version ${schemaVersion}`);
  }

  const architecture = requireString(manifest, 'architecture');
  if (!(SUPPORTED_ARCHITECTURES as readonly string[]).includes(architecture)) {
    throw new CheckpointValidationError(
      'architecture',
      `unsupported architecture ${architecture}; expected one of ${SUPPORTED_ARCHITECTURES.join(', ')}`,
    );
  }

  const dtype = requireString(manifest, 'dtype');
  if (!(SUPPORTED_DTYPES as readonly string[]).includes(dtype)) {
    throw new CheckpointValidationError(
      'dtype',
      `unsupported dtype ${dtype}; expected one of ${SUPPORTED_DTYPES.join(', ')}`,
    );
  }

  const sha = requireString(manifest, 'sha256');
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    throw new CheckpointValidationError('manifest', 'sha256 must be 64 lowercase hex characters');
  }

  requirePositiveInteger(manifest, 'latent_channels');
  requirePositiveInteger(manifest, 'sensor_channels');
  requirePositiveInteger(manifest, 'hidden_width');
  requireString(manifest, 'phenotype');
  requireString(manifest, 'checkpoint_version');
  requireNumber(manifest, 'training_seed');

  return manifest as unknown as CheckpointManifest;
}

/**
 * Tensor set required by an architecture, derived entirely from manifest
 * dimensions. No phenotype ever adds or removes a tensor — that is what makes
 * the runtime phenotype-agnostic.
 */
export function expectedTensorShapes(
  architecture: SupportedArchitecture,
  manifest: CheckpointManifest,
): Record<string, readonly number[]> {
  const inputWidth = manifest.latent_channels * 2 + manifest.sensor_channels;
  switch (architecture) {
    case 'vector_nca_mlp_v1':
      return {
        'net.0.weight': [manifest.hidden_width, inputWidth],
        'net.0.bias': [manifest.hidden_width],
        'net.2.weight': [manifest.latent_channels, manifest.hidden_width],
        'net.2.bias': [manifest.latent_channels],
      };
  }
}

function elementCount(shape: readonly number[]): number {
  return shape.reduce((total, dimension) => total * dimension, 1);
}

/**
 * Loads and fully validates a browser checkpoint container.
 *
 * Order matters: structure, then manifest, then declared shapes, then payload
 * length, then checksum, then a finite-value scan. Every failure names what was
 * expected and what arrived.
 */
export function loadBrowserCheckpoint(candidate: unknown): LoadedCheckpoint {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new CheckpointValidationError('container', 'container must be an object');
  }
  const container = candidate as Partial<BrowserCheckpointContainer>;

  if (container.container !== CONTAINER_TAG) {
    throw new CheckpointValidationError(
      'container',
      `expected container ${CONTAINER_TAG}, got ${String(container.container)}`,
    );
  }

  const manifest = validateCheckpointManifest(container.manifest);
  const architecture = manifest.architecture as SupportedArchitecture;

  if (typeof container.updateRate !== 'number' || !Number.isFinite(container.updateRate)) {
    throw new CheckpointValidationError('container', 'updateRate must be a finite number');
  }
  if (typeof container.payloadBase64 !== 'string') {
    throw new CheckpointValidationError('payload', 'payloadBase64 must be a string');
  }
  if (typeof container.payloadSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(container.payloadSha256)) {
    throw new CheckpointValidationError('checksum', 'payloadSha256 must be 64 lowercase hex characters');
  }
  if (!Array.isArray(container.tensors)) {
    throw new CheckpointValidationError('container', 'tensors must be an array');
  }

  const expected = expectedTensorShapes(architecture, manifest);
  const declared = new Map(container.tensors.map((entry) => [entry.name, entry]));

  for (const name of Object.keys(expected)) {
    if (!declared.has(name)) {
      throw new CheckpointValidationError('shape', `missing tensor ${name} required by ${architecture}`);
    }
  }
  for (const name of declared.keys()) {
    if (!(name in expected)) {
      throw new CheckpointValidationError('shape', `unexpected tensor ${name} for ${architecture}`);
    }
  }

  const bytes = decodeBase64(container.payloadBase64);
  if (bytes.length % 4 !== 0) {
    throw new CheckpointValidationError('payload', `payload length ${bytes.length} is not float32 aligned`);
  }

  const actualChecksum = sha256Hex(bytes);
  if (actualChecksum !== container.payloadSha256) {
    throw new CheckpointValidationError(
      'checksum',
      `payload checksum mismatch: expected ${container.payloadSha256}, computed ${actualChecksum}`,
    );
  }

  // Copy into an aligned buffer: a base64-derived array is not guaranteed to
  // start on a 4-byte boundary for a Float32Array view.
  const aligned = new Uint8Array(bytes.length);
  aligned.set(bytes);
  const payload = new Float32Array(aligned.buffer);

  const tensors: Record<string, CheckpointTensor> = {};
  let expectedElements = 0;

  for (const name of Object.keys(expected).sort()) {
    const entry = declared.get(name) as BrowserCheckpointContainer['tensors'][number];
    const expectedShape = expected[name] as readonly number[];

    if (!Array.isArray(entry.shape) || entry.shape.length !== expectedShape.length) {
      throw new CheckpointValidationError(
        'shape',
        `tensor ${name} must have rank ${expectedShape.length}`,
      );
    }
    entry.shape.forEach((dimension, axis) => {
      if (dimension !== expectedShape[axis]) {
        throw new CheckpointValidationError(
          'shape',
          `tensor ${name} axis ${axis}: expected ${expectedShape[axis]}, got ${dimension}`,
        );
      }
    });

    const count = elementCount(expectedShape);
    expectedElements += count;
    if (!Number.isInteger(entry.offset) || entry.offset < 0 || entry.offset + count > payload.length) {
      throw new CheckpointValidationError(
        'payload',
        `tensor ${name} range [${entry.offset}, ${entry.offset + count}) is outside the ${payload.length}-element payload`,
      );
    }

    const data = payload.subarray(entry.offset, entry.offset + count);
    for (let index = 0; index < data.length; index += 1) {
      if (!Number.isFinite(data[index] as number)) {
        throw new CheckpointValidationError(
          'corrupt',
          `tensor ${name} element ${index} is not finite`,
        );
      }
    }

    tensors[name] = { name, shape: expectedShape, data };
  }

  if (payload.length !== expectedElements) {
    throw new CheckpointValidationError(
      'payload',
      `payload holds ${payload.length} floats but ${architecture} needs exactly ${expectedElements}`,
    );
  }

  return {
    manifest,
    architecture,
    phenotype: manifest.phenotype,
    latentChannels: manifest.latent_channels,
    sensorChannels: manifest.sensor_channels,
    hiddenWidth: manifest.hidden_width,
    updateRate: Math.fround(container.updateRate),
    tensors,
    payloadSha256: container.payloadSha256,
  };
}
