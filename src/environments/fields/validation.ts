import { length } from './math';
import type { Vec3 } from './math';
import { EFFECT_GEOMETRY_KINDS } from './types';
import type { EffectGeometry, EffectSource } from './types';

export interface FieldValidationIssue {
  /** Offending source ID, or `<index n>` when the ID itself is unusable. */
  readonly sourceId: string;
  /** Dotted path of the offending field. */
  readonly field: string;
  readonly message: string;
}

export class FieldValidationError extends Error {
  readonly issues: readonly FieldValidationIssue[];

  constructor(issues: readonly FieldValidationIssue[]) {
    super(
      `invalid effect source declaration:\n${issues
        .map((issue) => `  source "${issue.sourceId}" field "${issue.field}": ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'FieldValidationError';
    this.issues = issues;
  }
}

function isVec3(value: unknown): value is Vec3 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Vec3>;
  return (
    Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && Number.isFinite(candidate.z)
  );
}

function checkVec3(
  issues: FieldValidationIssue[],
  sourceId: string,
  field: string,
  value: unknown,
): boolean {
  if (!isVec3(value)) {
    issues.push({
      sourceId,
      field,
      message: 'must be a vector with finite x, y, and z components',
    });
    return false;
  }
  return true;
}

function checkNumber(
  issues: FieldValidationIssue[],
  sourceId: string,
  field: string,
  value: unknown,
  predicate: (candidate: number) => boolean,
  requirement: string,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || !predicate(value)) {
    issues.push({
      sourceId,
      field,
      message: `${requirement} (received ${String(value)})`,
    });
  }
}

function validateGeometry(
  issues: FieldValidationIssue[],
  sourceId: string,
  geometry: EffectGeometry | undefined,
): void {
  if (typeof geometry !== 'object' || geometry === null) {
    issues.push({ sourceId, field: 'geometry', message: 'must be an object' });
    return;
  }

  switch (geometry.kind) {
    case 'point':
      checkVec3(issues, sourceId, 'geometry.position', geometry.position);
      return;
    case 'sphere':
      checkVec3(issues, sourceId, 'geometry.center', geometry.center);
      checkNumber(
        issues,
        sourceId,
        'geometry.radiusMeters',
        geometry.radiusMeters,
        (value) => value > 0,
        'must be greater than 0',
      );
      return;
    case 'box':
      checkVec3(issues, sourceId, 'geometry.center', geometry.center);
      if (checkVec3(issues, sourceId, 'geometry.halfExtentsMeters', geometry.halfExtentsMeters)) {
        const half = geometry.halfExtentsMeters;
        if (half.x < 0 || half.y < 0 || half.z < 0) {
          issues.push({
            sourceId,
            field: 'geometry.halfExtentsMeters',
            message: 'must not contain a negative component',
          });
        }
      }
      return;
    case 'capsule':
      checkVec3(issues, sourceId, 'geometry.start', geometry.start);
      checkVec3(issues, sourceId, 'geometry.end', geometry.end);
      checkNumber(
        issues,
        sourceId,
        'geometry.radiusMeters',
        geometry.radiusMeters,
        (value) => value >= 0,
        'must not be negative',
      );
      return;
    case 'plane':
      checkVec3(issues, sourceId, 'geometry.origin', geometry.origin);
      if (checkVec3(issues, sourceId, 'geometry.normal', geometry.normal)) {
        if (length(geometry.normal) === 0) {
          issues.push({
            sourceId,
            field: 'geometry.normal',
            message: 'must not be the zero vector',
          });
        }
      }
      return;
    default:
      issues.push({
        sourceId,
        field: 'geometry.kind',
        message: `must be one of ${EFFECT_GEOMETRY_KINDS.join(', ')} (received ${String(
          (geometry as { kind?: unknown }).kind,
        )})`,
      });
  }
}

/**
 * Collects every declaration problem instead of failing on the first one, so an
 * authoring pass reports all offending sources and fields at once.
 */
export function validateEffectSources(sources: readonly EffectSource[]): FieldValidationIssue[] {
  const issues: FieldValidationIssue[] = [];
  const seenIds = new Set<string>();

  sources.forEach((source, index) => {
    const hasUsableId = typeof source?.id === 'string' && source.id.length > 0;
    const sourceId = hasUsableId ? source.id : `<index ${index}>`;

    if (!hasUsableId) {
      issues.push({ sourceId, field: 'id', message: 'must be a non-empty string' });
    } else if (seenIds.has(source.id)) {
      issues.push({ sourceId, field: 'id', message: 'duplicates an earlier source ID' });
    } else {
      seenIds.add(source.id);
    }

    checkNumber(
      issues,
      sourceId,
      'strength',
      source?.strength,
      (value) => value >= -1 && value <= 1,
      'must be within [-1, 1]',
    );
    checkNumber(
      issues,
      sourceId,
      'rangeMeters',
      source?.rangeMeters,
      (value) => value > 0,
      'must be greater than 0',
    );
    validateGeometry(issues, sourceId, source?.geometry);
  });

  return issues;
}

export function assertValidEffectSources(sources: readonly EffectSource[]): void {
  const issues = validateEffectSources(sources);
  if (issues.length > 0) {
    throw new FieldValidationError(issues);
  }
}
