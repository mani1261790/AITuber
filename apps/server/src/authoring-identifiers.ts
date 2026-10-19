import {CoursePackageSchema, type CoursePackage} from '@aituber/contracts';

type Schema = {const?: unknown; type?: string; pattern?: string; minLength?: number; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[]};
const identifierPattern = '^[a-z][a-z0-9._:-]*$';
const isIdentifier = (schema: Schema) => schema.type === 'string' && schema.pattern === identifierPattern;

/** Accept short model-local names; the persisted contract still requires canonical IDs. */
export function allowShortAuthoringIdentifiers(schema: Schema): void {
  if (isIdentifier(schema)) schema.minLength = 1;
  for (const child of Object.values(schema.properties ?? {})) allowShortAuthoringIdentifiers(child);
  if (schema.items) allowShortAuthoringIdentifiers(schema.items);
  for (const child of schema.anyOf ?? []) allowShortAuthoringIdentifiers(child);
}

/** Rename only schema-declared IDs and references, never prose, formulas or code. */
export function normalizeAuthoringIdentifiers(value: CoursePackage): CoursePackage {
  const candidate = structuredClone(value);
  const occupied = new Set<string>();
  const short = new Set<string>();
  function visit(value: unknown, schema: Schema, rewrite?: Map<string, string>): unknown {
    if (isIdentifier(schema) && typeof value === 'string') {
      if (rewrite) return rewrite.get(value) ?? value;
      occupied.add(value);
      if (value.length > 0 && value.length < 3 && /^[a-z][a-z0-9._:-]*$/.test(value)) short.add(value);
    } else if (Array.isArray(value) && schema.items) {
      return value.map(item => visit(item, schema.items!, rewrite));
    } else if (value && typeof value === 'object' && schema.properties) {
      const object = value as Record<string, unknown>;
      for (const [key, child] of Object.entries(schema.properties)) {
        if (Object.hasOwn(object, key)) object[key] = visit(object[key], child, rewrite);
      }
    } else if (schema.anyOf) {
      for (const child of schema.anyOf) value = visit(value, child, rewrite);
    }
    return value;
  }
  visit(candidate, CoursePackageSchema);
  const mapping = new Map<string, string>();
  for (const id of [...short].sort()) {
    let normalized = `generated.${id}`;
    while (occupied.has(normalized)) normalized += '.id';
    occupied.add(normalized); mapping.set(id, normalized);
  }
  visit(candidate, CoursePackageSchema, mapping);
  return candidate;
}
