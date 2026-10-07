import { createHomeGeometryParts } from '../environments/homeGeometry';
import type { HomeBoxPart, HomeGeometryRole } from '../environments/homeGeometry';
import type { HomePresetManifest } from '../environments/homePresets';

/**
 * Analytic box collision for Home (replaces Jolt queries for M3).
 *
 * The organism moves on the floor as a disc of `radius`. A Home box blocks it
 * when its role is solid and its vertical span overlaps the organism's height.
 * Floors bound the walkable area; thresholds and apertures are walkable.
 */

export interface FloorRect {
  readonly id: string;
  readonly role: HomeGeometryRole;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface HomeColliders {
  /** Walkable floor footprint (the first floor part). */
  readonly floor: FloorRect;
  readonly floorY: number;
  /** Solid footprints that overlap the organism's height band. */
  readonly obstacles: readonly FloorRect[];
}

const SOLID_ROLES: ReadonlySet<HomeGeometryRole> = new Set(['wall', 'stair', 'furniture', 'perimeter', 'utility']);

function footprint(part: HomeBoxPart): FloorRect {
  const [sx, , sz] = part.size;
  const [px, , pz] = part.position;
  return { id: part.id, role: part.role, minX: px - sx / 2, maxX: px + sx / 2, minZ: pz - sz / 2, maxZ: pz + sz / 2 };
}

export function createHomeColliders(preset: HomePresetManifest, organismHeight: number): HomeColliders {
  const boxes = createHomeGeometryParts(preset).filter((part): part is HomeBoxPart => part.kind === 'box');
  const floorPart = boxes.find((part) => part.role === 'floor');
  if (!floorPart) throw new Error(`Home preset ${preset.id} has no floor`);
  const floorY = floorPart.position[1] + floorPart.size[1] / 2;
  const obstacles = boxes
    .filter((part) => SOLID_ROLES.has(part.role))
    .filter((part) => {
      const bottom = part.position[1] - part.size[1] / 2;
      const top = part.position[1] + part.size[1] / 2;
      return bottom < floorY + organismHeight && top > floorY + 0.01;
    })
    .map(footprint)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { floor: footprint(floorPart), floorY, obstacles };
}

/** Distance from (x, z) to the rectangle; zero inside. */
export function distanceToRect(rect: FloorRect, x: number, z: number): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return Math.hypot(dx, dz);
}

/** Clearance between a disc of `radius` at (x, z) and the nearest obstacle or floor edge. */
export function clearance(colliders: HomeColliders, x: number, z: number, radius: number): number {
  const { floor } = colliders;
  let nearest = Math.min(x - floor.minX, floor.maxX - x, z - floor.minZ, floor.maxZ - z);
  for (const obstacle of colliders.obstacles) nearest = Math.min(nearest, distanceToRect(obstacle, x, z));
  return nearest - radius;
}

/** Pushes a disc out of every obstacle (two passes) and back onto the floor. */
export function resolveDisc(colliders: HomeColliders, position: { x: number; z: number }, radius: number): void {
  for (let pass = 0; pass < 2; pass += 1) {
    for (const rect of colliders.obstacles) {
      const cx = Math.min(Math.max(position.x, rect.minX), rect.maxX);
      const cz = Math.min(Math.max(position.z, rect.minZ), rect.maxZ);
      const dx = position.x - cx;
      const dz = position.z - cz;
      const distance = Math.hypot(dx, dz);
      if (distance >= radius) continue;
      if (distance > 1e-9) {
        position.x = cx + (dx / distance) * radius;
        position.z = cz + (dz / distance) * radius;
      } else {
        // Centre inside the box: leave by the nearest face.
        const exits = [
          [position.x - rect.minX, rect.minX - radius, position.z],
          [rect.maxX - position.x, rect.maxX + radius, position.z],
          [position.z - rect.minZ, position.x, rect.minZ - radius],
          [rect.maxZ - position.z, position.x, rect.maxZ + radius],
        ] as const;
        let best = exits[0];
        for (const exit of exits) if (exit[0] < best[0]) best = exit;
        if (best === exits[0] || best === exits[1]) position.x = best[1];
        else position.z = best[2];
      }
    }
    const { floor } = colliders;
    position.x = Math.min(Math.max(position.x, floor.minX + radius), floor.maxX - radius);
    position.z = Math.min(Math.max(position.z, floor.minZ + radius), floor.maxZ - radius);
  }
}

/**
 * Grid navigation field over the floor: cost-to-goal per cell (8-connected
 * Dijkstra) for a disc of `radius`. Deterministic for a given goal.
 */
export class HomeNavGrid {
  readonly cell: number;
  readonly columns: number;
  readonly rows: number;
  readonly blocked: Uint8Array;
  private readonly originX: number;
  private readonly originZ: number;

  constructor(readonly colliders: HomeColliders, readonly radius: number, cell = 0.05) {
    const { floor } = colliders;
    this.cell = cell;
    this.originX = floor.minX;
    this.originZ = floor.minZ;
    this.columns = Math.ceil((floor.maxX - floor.minX) / cell);
    this.rows = Math.ceil((floor.maxZ - floor.minZ) / cell);
    this.blocked = new Uint8Array(this.columns * this.rows);
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const { x, z } = this.center(column, row);
        this.blocked[row * this.columns + column] = clearance(colliders, x, z, radius) < 0 ? 1 : 0;
      }
    }
  }

  center(column: number, row: number): { x: number; z: number } {
    return { x: this.originX + (column + 0.5) * this.cell, z: this.originZ + (row + 0.5) * this.cell };
  }

  cellOf(x: number, z: number): { column: number; row: number } {
    return {
      column: Math.min(this.columns - 1, Math.max(0, Math.floor((x - this.originX) / this.cell))),
      row: Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.originZ) / this.cell))),
    };
  }

  /** The free cell nearest (x, z), scanning rings outward in a fixed order. */
  nearestFree(x: number, z: number): { column: number; row: number } {
    const start = this.cellOf(x, z);
    for (let ring = 0; ring < Math.max(this.columns, this.rows); ring += 1) {
      let best: { column: number; row: number; distance: number } | null = null;
      for (let row = start.row - ring; row <= start.row + ring; row += 1) {
        for (let column = start.column - ring; column <= start.column + ring; column += 1) {
          if (Math.max(Math.abs(row - start.row), Math.abs(column - start.column)) !== ring) continue;
          if (row < 0 || column < 0 || row >= this.rows || column >= this.columns) continue;
          if (this.blocked[row * this.columns + column]) continue;
          const c = this.center(column, row);
          const distance = Math.hypot(c.x - x, c.z - z);
          if (!best || distance < best.distance) best = { column, row, distance };
        }
      }
      if (best) return { column: best.column, row: best.row };
    }
    throw new Error('Home nav grid has no free cell');
  }

  /** Cost-to-goal for every cell (Infinity when unreachable or blocked). */
  costField(goalX: number, goalZ: number): Float32Array {
    const cost = new Float32Array(this.columns * this.rows).fill(Infinity);
    const goal = this.nearestFree(goalX, goalZ);
    const goalIndex = goal.row * this.columns + goal.column;
    cost[goalIndex] = 0;
    // Dial-free Dijkstra with a binary heap keyed by cost, then index for ties.
    const heap: number[] = [goalIndex];
    const less = (a: number, b: number) => cost[a]! < cost[b]! || (cost[a] === cost[b] && a < b);
    const push = (value: number) => {
      heap.push(value);
      let child = heap.length - 1;
      while (child > 0) {
        const parent = (child - 1) >> 1;
        if (!less(heap[child]!, heap[parent]!)) break;
        [heap[child], heap[parent]] = [heap[parent]!, heap[child]!];
        child = parent;
      }
    };
    const pop = (): number => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let parent = 0;
        for (;;) {
          const left = parent * 2 + 1;
          const right = left + 1;
          let smallest = parent;
          if (left < heap.length && less(heap[left]!, heap[smallest]!)) smallest = left;
          if (right < heap.length && less(heap[right]!, heap[smallest]!)) smallest = right;
          if (smallest === parent) break;
          [heap[smallest], heap[parent]] = [heap[parent]!, heap[smallest]!];
          parent = smallest;
        }
      }
      return top;
    };
    const settled = new Uint8Array(cost.length);
    while (heap.length > 0) {
      const index = pop();
      if (settled[index]) continue;
      settled[index] = 1;
      const row = Math.floor(index / this.columns);
      const column = index % this.columns;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const nr = row + dr;
          const nc = column + dc;
          if (nr < 0 || nc < 0 || nr >= this.rows || nc >= this.columns) continue;
          const next = nr * this.columns + nc;
          if (this.blocked[next] || settled[next]) continue;
          // No corner cutting past a blocked cell.
          if (dr !== 0 && dc !== 0 && (this.blocked[row * this.columns + nc] || this.blocked[nr * this.columns + column])) continue;
          const step = dr !== 0 && dc !== 0 ? Math.SQRT2 : 1;
          const candidate = Math.fround(cost[index]! + step);
          if (candidate < cost[next]!) {
            cost[next] = candidate;
            push(next);
          }
        }
      }
    }
    return cost;
  }

  /** Centre of the lowest-cost neighbour of the cell containing (x, z), or null at the goal. */
  nextWaypoint(cost: Float32Array, x: number, z: number): { x: number; z: number } | null {
    const here = this.cellOf(x, z);
    const hereIndex = here.row * this.columns + here.column;
    let bestIndex = hereIndex;
    let best = cost[hereIndex]!;
    if (!Number.isFinite(best)) {
      const free = this.nearestFree(x, z);
      return this.center(free.column, free.row);
    }
    if (best === 0) return null;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const nr = here.row + dr;
        const nc = here.column + dc;
        if (nr < 0 || nc < 0 || nr >= this.rows || nc >= this.columns) continue;
        const index = nr * this.columns + nc;
        if (cost[index]! < best) {
          best = cost[index]!;
          bestIndex = index;
        }
      }
    }
    return this.center(bestIndex % this.columns, Math.floor(bestIndex / this.columns));
  }
}
