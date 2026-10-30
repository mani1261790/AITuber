/** Wire-only schema: retain the original schema for validation after generation. */
export function strictCourseSchema(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(strictCourseSchema);
  if (!input || typeof input !== 'object') return input;
  const node = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  // These constraints remain enforced by parseAndValidate with the original schema.
  const localOnly = new Set(['uniqueItems', 'minLength', 'maxLength', 'exclusiveMinimum', 'exclusiveMaximum']);
  for (const [key, value] of Object.entries(node)) {
    if (!localOnly.has(key)) result[key] = strictCourseSchema(value);
  }
  if ('const' in result) { result.enum = [result.const]; delete result.const; }
  if (node.type === 'object' && node.properties && typeof node.properties === 'object') {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    const properties = result.properties as Record<string, unknown>;
    for (const key of Object.keys(properties)) {
      if (!required.has(key)) properties[key] = {anyOf: [properties[key], {type:'null'}]};
    }
    result.required = Object.keys(properties);
    result.additionalProperties = false;
  }
  return result;
}

/** Course Package v1 has no nullable fields; null denotes an omitted optional field. */
export function omitCourseNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitCourseNulls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([,entry])=>entry!==null).map(([key,entry])=>[key,omitCourseNulls(entry)]));
}
