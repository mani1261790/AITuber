import { describe, expect, it } from 'vitest';
import Ajv from './ajv';
import { CoursePackageSchema } from '@aituber/contracts';
import { quadraticFunctionsFixture } from '@aituber/content';

describe('Worker schema validation without dynamic code generation', () => {
  it('accepts a complete course and rejects a missing unit and extra field', () => {
    const validate = new Ajv().compile(CoursePackageSchema);
    expect(validate(quadraticFunctionsFixture)).toBe(true);
    expect(validate({...quadraticFunctionsFixture, units: []})).toBe(false);
    expect(validate.errors.length).toBeGreaterThan(0);
    expect(validate({...quadraticFunctionsFixture, unexpected: true})).toBe(false);
  });
});
