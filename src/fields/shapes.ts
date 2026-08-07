import type { FieldGeometry, Vec3 } from './types';

/**
 * Closest-surface query result. `distance` is signed meters: negative only
 * inside closed volumes. `point` and `normal` describe the authored contact
 * surface so emission can originate where matter actually touches.
 */
export interface SurfaceQuery {
  distance: number;
  pointX: number;
  pointY: number;
  pointZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
}

export function createSurfaceQuery(): SurfaceQuery {
  return {
    distance: Number.POSITIVE_INFINITY,
    pointX: 0,
    pointY: 0,
    pointZ: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
  };
}

function writeNormal(out: SurfaceQuery, x: number, y: number, z: number): void {
  const length = Math.hypot(x, y, z);
  if (length <= 1e-9) {
    out.normalX = 0;
    out.normalY = 1;
    out.normalZ = 0;
    return;
  }
  out.normalX = x / length;
  out.normalY = y / length;
  out.normalZ = z / length;
}

function closestPointOnSegment(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  out: [number, number, number],
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared <= 1e-12) {
    out[0] = ax;
    out[1] = ay;
    out[2] = az;
    return;
  }
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lengthSquared));
  out[0] = ax + dx * t;
  out[1] = ay + dy * t;
  out[2] = az + dz * t;
}

const segmentScratch: [number, number, number] = [0, 0, 0];
const triangleScratch: [number, number, number] = [0, 0, 0];

function pointQuery(position: Vec3, x: number, y: number, z: number, out: SurfaceQuery): void {
  const [cx, cy, cz] = position;
  out.pointX = cx;
  out.pointY = cy;
  out.pointZ = cz;
  out.distance = Math.hypot(x - cx, y - cy, z - cz);
  writeNormal(out, x - cx, y - cy, z - cz);
}

function sphereQuery(
  center: Vec3,
  radius: number,
  x: number,
  y: number,
  z: number,
  out: SurfaceQuery,
): void {
  const [cx, cy, cz] = center;
  const dx = x - cx;
  const dy = y - cy;
  const dz = z - cz;
  const length = Math.hypot(dx, dy, dz);
  out.distance = length - radius;
  writeNormal(out, dx, dy, dz);
  out.pointX = cx + out.normalX * radius;
  out.pointY = cy + out.normalY * radius;
  out.pointZ = cz + out.normalZ * radius;
}

function boxQuery(
  center: Vec3,
  halfExtents: Vec3,
  yawRadians: number,
  x: number,
  y: number,
  z: number,
  out: SurfaceQuery,
): void {
  const [cx, cy, cz] = center;
  const [hx, hy, hz] = halfExtents;
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  // World to box-local (inverse yaw rotation about +Y).
  const rx = x - cx;
  const ry = y - cy;
  const rz = z - cz;
  const lx = rx * cos + rz * sin;
  const ly = ry;
  const lz = -rx * sin + rz * cos;

  const clampedX = Math.min(hx, Math.max(-hx, lx));
  const clampedY = Math.min(hy, Math.max(-hy, ly));
  const clampedZ = Math.min(hz, Math.max(-hz, lz));
  const insideX = Math.abs(lx) <= hx;
  const insideY = Math.abs(ly) <= hy;
  const insideZ = Math.abs(lz) <= hz;

  let surfaceX = clampedX;
  let surfaceY = clampedY;
  let surfaceZ = clampedZ;
  let localNormalX = 0;
  let localNormalY = 0;
  let localNormalZ = 0;

  if (insideX && insideY && insideZ) {
    // Deepest point: push out along the axis of least penetration. Ties resolve
    // X, then Y, then Z so the result never depends on evaluation order.
    const penetrationX = hx - Math.abs(lx);
    const penetrationY = hy - Math.abs(ly);
    const penetrationZ = hz - Math.abs(lz);
    const minimum = Math.min(penetrationX, penetrationY, penetrationZ);
    out.distance = -minimum;
    if (penetrationX === minimum) {
      localNormalX = lx >= 0 ? 1 : -1;
      surfaceX = localNormalX * hx;
    } else if (penetrationY === minimum) {
      localNormalY = ly >= 0 ? 1 : -1;
      surfaceY = localNormalY * hy;
    } else {
      localNormalZ = lz >= 0 ? 1 : -1;
      surfaceZ = localNormalZ * hz;
    }
  } else {
    const dx = lx - clampedX;
    const dy = ly - clampedY;
    const dz = lz - clampedZ;
    out.distance = Math.hypot(dx, dy, dz);
    localNormalX = dx;
    localNormalY = dy;
    localNormalZ = dz;
  }

  // Box-local back to world.
  out.pointX = cx + surfaceX * cos - surfaceZ * sin;
  out.pointY = cy + surfaceY;
  out.pointZ = cz + surfaceX * sin + surfaceZ * cos;
  writeNormal(
    out,
    localNormalX * cos - localNormalZ * sin,
    localNormalY,
    localNormalX * sin + localNormalZ * cos,
  );
}

function capsuleQuery(
  path: readonly Vec3[],
  radius: number,
  x: number,
  y: number,
  z: number,
  out: SurfaceQuery,
): void {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestX = path[0]?.[0] ?? 0;
  let bestY = path[0]?.[1] ?? 0;
  let bestZ = path[0]?.[2] ?? 0;

  if (path.length === 1) {
    const only = path[0] ?? [0, 0, 0];
    bestX = only[0];
    bestY = only[1];
    bestZ = only[2];
    bestDistance = Math.hypot(x - bestX, y - bestY, z - bestZ);
  }

  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1] ?? [0, 0, 0];
    const end = path[index] ?? start;
    closestPointOnSegment(
      x,
      y,
      z,
      start[0],
      start[1],
      start[2],
      end[0],
      end[1],
      end[2],
      segmentScratch,
    );
    const distance = Math.hypot(x - segmentScratch[0], y - segmentScratch[1], z - segmentScratch[2]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestX = segmentScratch[0];
      bestY = segmentScratch[1];
      bestZ = segmentScratch[2];
    }
  }

  out.distance = bestDistance - radius;
  writeNormal(out, x - bestX, y - bestY, z - bestZ);
  out.pointX = bestX + out.normalX * radius;
  out.pointY = bestY + out.normalY * radius;
  out.pointZ = bestZ + out.normalZ * radius;
}

/** Deterministic tangent basis for a finite plane patch. */
function planeBasis(normal: Vec3): { tangent: Vec3; bitangent: Vec3; unit: Vec3 } {
  const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const unit: Vec3 = [normal[0] / length, normal[1] / length, normal[2] / length];
  const reference: Vec3 = Math.abs(unit[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const tx = reference[1] * unit[2] - reference[2] * unit[1];
  const ty = reference[2] * unit[0] - reference[0] * unit[2];
  const tz = reference[0] * unit[1] - reference[1] * unit[0];
  const tangentLength = Math.hypot(tx, ty, tz) || 1;
  const tangent: Vec3 = [tx / tangentLength, ty / tangentLength, tz / tangentLength];
  const bitangent: Vec3 = [
    unit[1] * tangent[2] - unit[2] * tangent[1],
    unit[2] * tangent[0] - unit[0] * tangent[2],
    unit[0] * tangent[1] - unit[1] * tangent[0],
  ];
  return { tangent, bitangent, unit };
}

function planeQuery(
  center: Vec3,
  normal: Vec3,
  halfExtents: readonly [number, number],
  x: number,
  y: number,
  z: number,
  out: SurfaceQuery,
): void {
  const { tangent, bitangent, unit } = planeBasis(normal);
  const dx = x - center[0];
  const dy = y - center[1];
  const dz = z - center[2];
  const along = dx * unit[0] + dy * unit[1] + dz * unit[2];
  const u = dx * tangent[0] + dy * tangent[1] + dz * tangent[2];
  const v = dx * bitangent[0] + dy * bitangent[1] + dz * bitangent[2];
  const clampedU = Math.min(halfExtents[0], Math.max(-halfExtents[0], u));
  const clampedV = Math.min(halfExtents[1], Math.max(-halfExtents[1], v));

  out.pointX = center[0] + tangent[0] * clampedU + bitangent[0] * clampedV;
  out.pointY = center[1] + tangent[1] * clampedU + bitangent[1] * clampedV;
  out.pointZ = center[2] + tangent[2] * clampedU + bitangent[2] * clampedV;

  if (clampedU === u && clampedV === v) {
    // Over the patch footprint: keep the sign so a wall or floor reads as a
    // usable signed distance for collision.
    out.distance = along;
    const side = along >= 0 ? 1 : -1;
    writeNormal(out, unit[0] * side, unit[1] * side, unit[2] * side);
    return;
  }
  out.distance = Math.hypot(x - out.pointX, y - out.pointY, z - out.pointZ);
  writeNormal(out, x - out.pointX, y - out.pointY, z - out.pointZ);
}

function closestPointOnTriangle(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  out: [number, number, number],
): void {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    out[0] = ax;
    out[1] = ay;
    out[2] = az;
    return;
  }

  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    out[0] = bx;
    out[1] = by;
    out[2] = bz;
    return;
  }

  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    out[0] = cx;
    out[1] = cy;
    out[2] = cz;
    return;
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    out[0] = ax + abx * t;
    out[1] = ay + aby * t;
    out[2] = az + abz * t;
    return;
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    out[0] = ax + acx * t;
    out[1] = ay + acy * t;
    out[2] = az + acz * t;
    return;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out[0] = bx + (cx - bx) * t;
    out[1] = by + (cy - by) * t;
    out[2] = bz + (cz - bz) * t;
    return;
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
}

function meshQuery(
  triangles: readonly number[],
  x: number,
  y: number,
  z: number,
  out: SurfaceQuery,
): void {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestX = 0;
  let bestY = 0;
  let bestZ = 0;
  let bestNormalX = 0;
  let bestNormalY = 1;
  let bestNormalZ = 0;

  for (let offset = 0; offset + 8 < triangles.length; offset += 9) {
    const ax = triangles[offset] ?? 0;
    const ay = triangles[offset + 1] ?? 0;
    const az = triangles[offset + 2] ?? 0;
    const bx = triangles[offset + 3] ?? 0;
    const by = triangles[offset + 4] ?? 0;
    const bz = triangles[offset + 5] ?? 0;
    const cx = triangles[offset + 6] ?? 0;
    const cy = triangles[offset + 7] ?? 0;
    const cz = triangles[offset + 8] ?? 0;
    closestPointOnTriangle(x, y, z, ax, ay, az, bx, by, bz, cx, cy, cz, triangleScratch);
    const distance = Math.hypot(
      x - triangleScratch[0],
      y - triangleScratch[1],
      z - triangleScratch[2],
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestX = triangleScratch[0];
      bestY = triangleScratch[1];
      bestZ = triangleScratch[2];
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      bestNormalX = uy * vz - uz * vy;
      bestNormalY = uz * vx - ux * vz;
      bestNormalZ = ux * vy - uy * vx;
    }
  }

  out.distance = bestDistance;
  out.pointX = bestX;
  out.pointY = bestY;
  out.pointZ = bestZ;
  // Face normals point away from the sampled side so contact emission never
  // renders behind the surface it came from.
  const facing =
    bestNormalX * (x - bestX) + bestNormalY * (y - bestY) + bestNormalZ * (z - bestZ) >= 0 ? 1 : -1;
  writeNormal(out, bestNormalX * facing, bestNormalY * facing, bestNormalZ * facing);
}

/** Sample the closest authored surface of one geometry adapter. */
export function evaluateGeometry(
  geometry: FieldGeometry,
  x: number,
  y: number,
  z: number,
  out: SurfaceQuery,
): SurfaceQuery {
  switch (geometry.kind) {
    case 'point':
      pointQuery(geometry.position, x, y, z, out);
      return out;
    case 'sphere':
      sphereQuery(geometry.center, geometry.radiusMeters, x, y, z, out);
      return out;
    case 'box':
      boxQuery(geometry.center, geometry.halfExtents, geometry.yawRadians ?? 0, x, y, z, out);
      return out;
    case 'capsule':
      capsuleQuery(geometry.path, geometry.radiusMeters, x, y, z, out);
      return out;
    case 'plane':
      planeQuery(geometry.center, geometry.normal, geometry.halfExtents, x, y, z, out);
      return out;
    case 'mesh':
      meshQuery(geometry.triangles, x, y, z, out);
      return out;
  }
}

/** World-space bounds of the authored surface, before influence range. */
export function geometryBounds(geometry: FieldGeometry): { min: Vec3; max: Vec3 } {
  switch (geometry.kind) {
    case 'point':
      return { min: geometry.position, max: geometry.position };
    case 'sphere': {
      const [cx, cy, cz] = geometry.center;
      const r = geometry.radiusMeters;
      return { min: [cx - r, cy - r, cz - r], max: [cx + r, cy + r, cz + r] };
    }
    case 'box': {
      const [cx, cy, cz] = geometry.center;
      const [hx, hy, hz] = geometry.halfExtents;
      const cos = Math.abs(Math.cos(geometry.yawRadians ?? 0));
      const sin = Math.abs(Math.sin(geometry.yawRadians ?? 0));
      const spanX = hx * cos + hz * sin;
      const spanZ = hx * sin + hz * cos;
      return {
        min: [cx - spanX, cy - hy, cz - spanZ],
        max: [cx + spanX, cy + hy, cz + spanZ],
      };
    }
    case 'capsule': {
      const r = geometry.radiusMeters;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (const point of geometry.path) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        minZ = Math.min(minZ, point[2]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
        maxZ = Math.max(maxZ, point[2]);
      }
      return { min: [minX - r, minY - r, minZ - r], max: [maxX + r, maxY + r, maxZ + r] };
    }
    case 'plane': {
      const { tangent, bitangent } = planeBasis(geometry.normal);
      const [hu, hv] = geometry.halfExtents;
      const spanX = Math.abs(tangent[0]) * hu + Math.abs(bitangent[0]) * hv;
      const spanY = Math.abs(tangent[1]) * hu + Math.abs(bitangent[1]) * hv;
      const spanZ = Math.abs(tangent[2]) * hu + Math.abs(bitangent[2]) * hv;
      const [cx, cy, cz] = geometry.center;
      return {
        min: [cx - spanX, cy - spanY, cz - spanZ],
        max: [cx + spanX, cy + spanY, cz + spanZ],
      };
    }
    case 'mesh': {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (let offset = 0; offset + 2 < geometry.triangles.length; offset += 3) {
        const x = geometry.triangles[offset] ?? 0;
        const y = geometry.triangles[offset + 1] ?? 0;
        const z = geometry.triangles[offset + 2] ?? 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
      }
      return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
    }
  }
}

/** Translate an authored geometry without rebuilding its descriptor shape. */
export function translateGeometry(geometry: FieldGeometry, delta: Vec3): FieldGeometry {
  const [dx, dy, dz] = delta;
  const move = (point: Vec3): Vec3 => [point[0] + dx, point[1] + dy, point[2] + dz];
  switch (geometry.kind) {
    case 'point':
      return { kind: 'point', position: move(geometry.position) };
    case 'sphere':
      return { kind: 'sphere', center: move(geometry.center), radiusMeters: geometry.radiusMeters };
    case 'box':
      return {
        kind: 'box',
        center: move(geometry.center),
        halfExtents: geometry.halfExtents,
        yawRadians: geometry.yawRadians,
      };
    case 'capsule':
      return {
        kind: 'capsule',
        path: geometry.path.map(move),
        radiusMeters: geometry.radiusMeters,
      };
    case 'plane':
      return {
        kind: 'plane',
        center: move(geometry.center),
        normal: geometry.normal,
        halfExtents: geometry.halfExtents,
      };
    case 'mesh': {
      const triangles = geometry.triangles.slice();
      for (let offset = 0; offset + 2 < triangles.length; offset += 3) {
        triangles[offset] = (triangles[offset] ?? 0) + dx;
        triangles[offset + 1] = (triangles[offset + 1] ?? 0) + dy;
        triangles[offset + 2] = (triangles[offset + 2] ?? 0) + dz;
      }
      return { kind: 'mesh', triangles };
    }
  }
}
