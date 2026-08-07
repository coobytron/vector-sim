function hashBytes(hash: number, bytes: Uint8Array): number {
  let value = hash >>> 0;
  for (const byte of bytes) {
    value ^= byte;
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export function hashState(arrays: ArrayBufferView[], tick: number): string {
  let hash = 0x811c9dc5;
  const tickBytes = new Uint8Array(4);
  new DataView(tickBytes.buffer).setUint32(0, tick >>> 0, true);
  hash = hashBytes(hash, tickBytes);

  for (const array of arrays) {
    hash = hashBytes(hash, new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }

  return hash.toString(16).padStart(8, '0');
}

