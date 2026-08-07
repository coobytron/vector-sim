import type { Vec3 } from './types';

export interface SourceBounds {
  min: Vec3;
  max: Vec3;
}

const MAX_CELLS = 262_144;

/**
 * Uniform-grid index over source influence bounds.
 *
 * The grid is dense across the environment bounds, so a lookup is an exact
 * array index rather than a hash that could collide. Each source is inserted
 * into every cell its influence AABB overlaps, which makes a point query read
 * one cell. Positions outside the authored bounds clamp to the border cell, so
 * influence that reaches past the bounds is still found.
 *
 * Moving a source re-buckets that source alone; the grid is never rebuilt for
 * animation.
 */
export class FieldSpatialIndex {
  readonly cellSize: number;
  readonly dimensions: readonly [number, number, number];

  private readonly origin: Vec3;
  private readonly cells: number[][];
  private readonly occupancy: number[][] = [];

  constructor(bounds: SourceBounds, cellSize: number, sourceBounds: readonly SourceBounds[]) {
    if (!(cellSize > 0)) {
      throw new RangeError(`Field grid cell size must be positive, received ${cellSize}`);
    }
    this.origin = bounds.min;

    let size = cellSize;
    let dimensions = gridDimensions(bounds, size);
    while (dimensions[0] * dimensions[1] * dimensions[2] > MAX_CELLS) {
      size *= 2;
      dimensions = gridDimensions(bounds, size);
    }
    this.cellSize = size;
    this.dimensions = dimensions;
    this.cells = new Array<number[]>(dimensions[0] * dimensions[1] * dimensions[2]);

    for (let index = 0; index < sourceBounds.length; index += 1) {
      this.occupancy.push([]);
      this.insert(index, sourceBounds[index] as SourceBounds);
    }
  }

  private axisCell(value: number, axis: number): number {
    const cell = Math.floor((value - (this.origin[axis] ?? 0)) / this.cellSize);
    return Math.min((this.dimensions[axis] ?? 1) - 1, Math.max(0, cell));
  }

  private cellIndex(x: number, y: number, z: number): number {
    const [, height, depth] = this.dimensions;
    return (x * height + y) * depth + z;
  }

  private insert(index: number, bounds: SourceBounds): void {
    const occupied = this.occupancy[index] as number[];
    const minX = this.axisCell(bounds.min[0], 0);
    const minY = this.axisCell(bounds.min[1], 1);
    const minZ = this.axisCell(bounds.min[2], 2);
    const maxX = this.axisCell(bounds.max[0], 0);
    const maxY = this.axisCell(bounds.max[1], 1);
    const maxZ = this.axisCell(bounds.max[2], 2);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const key = this.cellIndex(x, y, z);
          const bucket = this.cells[key];
          if (bucket) bucket.push(index);
          else this.cells[key] = [index];
          occupied.push(key);
        }
      }
    }
  }

  private remove(index: number): void {
    const occupied = this.occupancy[index] as number[];
    for (const key of occupied) {
      const bucket = this.cells[key];
      if (!bucket) continue;
      const position = bucket.indexOf(index);
      if (position >= 0) bucket.splice(position, 1);
    }
    occupied.length = 0;
  }

  /** Re-bucket a single source after it moved, resized, or changed range. */
  update(index: number, bounds: SourceBounds): void {
    this.remove(index);
    this.insert(index, bounds);
  }

  /**
   * Grid cell a world position falls in. Callers batching nearby samples use
   * this to reuse a candidate list instead of re-querying per position.
   */
  cellKeyFor(x: number, y: number, z: number): number {
    return this.cellIndex(this.axisCell(x, 0), this.axisCell(y, 1), this.axisCell(z, 2));
  }

  /**
   * Candidate source indices for a world position, in ascending source order so
   * accumulation never depends on grid traversal or declaration order.
   */
  query(x: number, y: number, z: number, out: number[]): number[] {
    out.length = 0;
    const bucket =
      this.cells[this.cellIndex(this.axisCell(x, 0), this.axisCell(y, 1), this.axisCell(z, 2))];
    if (!bucket || bucket.length === 0) return out;
    for (const index of bucket) out.push(index);
    // Buckets stay small (authored sources per cell), so an insertion sort is
    // cheaper than allocating a comparator closure per query.
    for (let i = 1; i < out.length; i += 1) {
      const value = out[i] as number;
      let j = i - 1;
      while (j >= 0 && (out[j] as number) > value) {
        out[j + 1] = out[j] as number;
        j -= 1;
      }
      out[j + 1] = value;
    }
    return out;
  }
}

function gridDimensions(bounds: SourceBounds, cellSize: number): [number, number, number] {
  const span = (axis: number): number =>
    Math.max(1, Math.ceil(((bounds.max[axis] ?? 0) - (bounds.min[axis] ?? 0)) / cellSize));
  return [span(0), span(1), span(2)];
}
