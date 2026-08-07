const UINT32_SCALE = 1 / 4_294_967_296;

export function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

export function counterRandom(
  seed: number,
  organismId: number,
  cellId: number,
  tick: number,
  stream = 0,
): number {
  let counter = seed >>> 0;
  counter = mix32(counter ^ Math.imul(organismId + 1, 0x9e3779b1));
  counter = mix32(counter ^ Math.imul(cellId + 1, 0x85ebca77));
  counter = mix32(counter ^ Math.imul(tick + 1, 0xc2b2ae3d));
  counter = mix32(counter ^ Math.imul(stream + 1, 0x27d4eb2f));
  return counter * UINT32_SCALE;
}

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) * UINT32_SCALE;
  }

  signed(): number {
    return this.next() * 2 - 1;
  }
}

