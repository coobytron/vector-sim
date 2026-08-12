import { describe, expect, it } from 'vitest';
import fixture from '../src/nca/models/p06a-reference-checkpoint.json';
import {
  CheckpointValidationError,
  decodeBase64,
  encodeBase64,
  expectedTensorShapes,
  loadBrowserCheckpoint,
  sha256Hex,
  validateCheckpointManifest,
} from '../src/nca';
import type { BrowserCheckpointContainer } from '../src/nca';

const container = fixture as unknown as BrowserCheckpointContainer;

/** Mutable mirror of the container so corruption cases stay readable. */
interface MutableContainer {
  container: string;
  manifest: Record<string, unknown>;
  updateRate?: number;
  tensors: { name: string; shape: number[]; offset: number }[];
  payloadBase64: string;
  payloadSha256: string;
}

function clone(): MutableContainer {
  return JSON.parse(JSON.stringify(container)) as MutableContainer;
}

/** Re-encodes a mutated float payload with a matching checksum. */
function withPayload(
  base: MutableContainer,
  mutate: (payload: Float32Array) => void,
): MutableContainer {
  const bytes = decodeBase64(base.payloadBase64);
  const aligned = new Uint8Array(bytes.length);
  aligned.set(bytes);
  const payload = new Float32Array(aligned.buffer);
  mutate(payload);
  const updated = new Uint8Array(payload.buffer);
  return {
    ...base,
    payloadBase64: encodeBase64(updated),
    payloadSha256: sha256Hex(updated),
  };
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CheckpointValidationError);
    expect((error as CheckpointValidationError).code).toBe(code);
    return;
  }
  throw new Error(`expected a ${code} CheckpointValidationError`);
}

describe('sha256', () => {
  it('matches the published FIPS 180-4 vectors', () => {
    const ascii = (value: string): Uint8Array =>
      Uint8Array.from(value, (character) => character.charCodeAt(0));
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(ascii('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex(ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });
});

describe('base64 round trip', () => {
  it('round trips every trailing-byte case', () => {
    for (let length = 0; length < 12; length += 1) {
      const bytes = Uint8Array.from({ length }, (_unused, index) => (index * 37 + 11) & 0xff);
      expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('rejects a malformed payload string', () => {
    expectCode(() => decodeBase64('!!!!'), 'payload');
    expectCode(() => decodeBase64('AAA'), 'payload');
  });
});

describe('P05a manifest parsing', () => {
  it('loads the P05a-format fixture manifest without hand editing', () => {
    const manifest = validateCheckpointManifest(container.manifest);
    expect(manifest.architecture).toBe('vector_nca_mlp_v1');
    expect(manifest.dtype).toBe('float32');
    expect(manifest.schema_version).toBe(1);
    expect(manifest.latent_channels).toBe(16);
    expect(manifest.sensor_channels).toBe(6);
    expect(manifest.hidden_width).toBe(64);
    expect(manifest.training_seed).toBe(240807);
    expect(manifest.limitations.length).toBeGreaterThan(0);
  });

  it('keeps unknown forward-compatible fields instead of rejecting them', () => {
    const extended = { ...container.manifest, p05b_curriculum: 'stage-2' };
    expect(validateCheckpointManifest(extended)).toMatchObject({ p05b_curriculum: 'stage-2' });
  });

  it('derives the tensor set from manifest dimensions alone', () => {
    expect(expectedTensorShapes('vector_nca_mlp_v1', container.manifest)).toEqual({
      'net.0.weight': [64, 38],
      'net.0.bias': [64],
      'net.2.weight': [16, 64],
      'net.2.bias': [16],
    });
  });

  it('rejects an unsupported schema version, architecture, and dtype', () => {
    expectCode(() => validateCheckpointManifest({ ...container.manifest, schema_version: 2 }), 'manifest');
    expectCode(
      () => validateCheckpointManifest({ ...container.manifest, architecture: 'vector_nca_gnn_v9' }),
      'architecture',
    );
    expectCode(() => validateCheckpointManifest({ ...container.manifest, dtype: 'float16' }), 'dtype');
    expectCode(() => validateCheckpointManifest({ ...container.manifest, dtype: 'bfloat16' }), 'dtype');
  });

  it('rejects malformed dimensions and checksums', () => {
    expectCode(() => validateCheckpointManifest({ ...container.manifest, latent_channels: 0 }), 'manifest');
    expectCode(() => validateCheckpointManifest({ ...container.manifest, hidden_width: 12.5 }), 'manifest');
    expectCode(() => validateCheckpointManifest({ ...container.manifest, sha256: 'abc' }), 'manifest');
    expectCode(() => validateCheckpointManifest(null), 'manifest');
  });
});

describe('browser container loading', () => {
  it('loads the fixture and exposes phenotype-agnostic dimensions', () => {
    const checkpoint = loadBrowserCheckpoint(container);
    expect(checkpoint.architecture).toBe('vector_nca_mlp_v1');
    expect(checkpoint.latentChannels).toBe(16);
    expect(checkpoint.sensorChannels).toBe(6);
    expect(checkpoint.hiddenWidth).toBe(64);
    expect(checkpoint.updateRate).toBe(0.5);
    expect(Object.keys(checkpoint.tensors).sort()).toEqual([
      'net.0.bias',
      'net.0.weight',
      'net.2.bias',
      'net.2.weight',
    ]);
    expect(checkpoint.tensors['net.0.weight']?.data.length).toBe(64 * 38);
    expect(checkpoint.tensors['net.2.bias']?.data.length).toBe(16);
  });

  it('is phenotype-agnostic: the same contract loads every phenotype name', () => {
    for (const phenotype of ['branching', 'ribbon', 'radial']) {
      const variant = clone();
      variant.manifest.phenotype = phenotype;
      const checkpoint = loadBrowserCheckpoint(variant);
      expect(checkpoint.phenotype).toBe(phenotype);
      expect(Object.keys(checkpoint.tensors).length).toBe(4);
    }
  });

  it('rejects a wrong container tag', () => {
    const variant = clone();
    variant.container = 'safetensors.v0';
    expectCode(() => loadBrowserCheckpoint(variant), 'container');
    expectCode(() => loadBrowserCheckpoint('not-an-object'), 'container');
  });

  it('rejects a checksum mismatch', () => {
    const variant = clone();
    variant.payloadSha256 = 'f'.repeat(64);
    expectCode(() => loadBrowserCheckpoint(variant), 'checksum');
  });

  it('rejects a payload that no longer matches its checksum', () => {
    const tampered = clone();
    const bytes = decodeBase64(tampered.payloadBase64);
    bytes[0] = (bytes[0] as number) ^ 0xff;
    tampered.payloadBase64 = encodeBase64(bytes);
    expectCode(() => loadBrowserCheckpoint(tampered), 'checksum');
  });

  it('rejects a dimension change that the payload does not match', () => {
    const variant = clone();
    variant.manifest.hidden_width = 65;
    expectCode(() => loadBrowserCheckpoint(variant), 'shape');
  });

  it('rejects a declared tensor shape that contradicts the manifest', () => {
    const variant = clone();
    const entry = variant.tensors.find((tensor) => tensor.name === 'net.2.bias');
    if (entry) entry.shape = [15];
    expectCode(() => loadBrowserCheckpoint(variant), 'shape');
  });

  it('rejects missing and unexpected tensors', () => {
    const missing = clone();
    missing.tensors = missing.tensors.filter((tensor) => tensor.name !== 'net.0.bias');
    expectCode(() => loadBrowserCheckpoint(missing), 'shape');

    const extra = clone();
    extra.tensors.push({ name: 'net.4.weight', shape: [1], offset: 0 });
    expectCode(() => loadBrowserCheckpoint(extra), 'shape');
  });

  it('rejects a tensor offset that runs past the payload', () => {
    const variant = clone();
    const entry = variant.tensors.find((tensor) => tensor.name === 'net.2.bias');
    if (entry) entry.offset = 999_999;
    expectCode(() => loadBrowserCheckpoint(variant), 'payload');
  });

  it('rejects NaN and Infinity weights', () => {
    expectCode(
      () => loadBrowserCheckpoint(withPayload(clone(), (payload) => (payload[7] = Number.NaN))),
      'corrupt',
    );
    expectCode(
      () =>
        loadBrowserCheckpoint(
          withPayload(clone(), (payload) => (payload[11] = Number.POSITIVE_INFINITY)),
        ),
      'corrupt',
    );
  });

  it('takes update_rate from the manifest when present', () => {
    const variant = clone();
    variant.manifest.update_rate = 0.25;
    delete variant.updateRate;
    expect(loadBrowserCheckpoint(variant).updateRate).toBe(0.25);
  });

  it('falls back to the container for manifests predating update_rate', () => {
    const variant = clone();
    delete variant.manifest.update_rate;
    variant.updateRate = 0.75;
    expect(loadBrowserCheckpoint(variant).updateRate).toBe(0.75);
  });

  it('rejects a container rate that contradicts the manifest', () => {
    const variant = clone();
    variant.manifest.update_rate = 0.5;
    variant.updateRate = 0.9;
    expectCode(() => loadBrowserCheckpoint(variant), 'container');
  });

  it('rejects a missing update rate on both sides', () => {
    const variant = clone();
    delete variant.manifest.update_rate;
    delete variant.updateRate;
    expectCode(() => loadBrowserCheckpoint(variant), 'container');
  });

  it('rejects a non-finite manifest update_rate', () => {
    const variant = clone();
    variant.manifest.update_rate = 'fast';
    expectCode(() => loadBrowserCheckpoint(variant), 'manifest');
  });
});
