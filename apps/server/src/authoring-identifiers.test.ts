import {expect, it} from 'vitest';
import {quadraticFunctionsFixture} from '@aituber/content';
import {parseCoursePackage, CoursePackageSchema, type CoursePackage} from '@aituber/contracts';
import {allowShortAuthoringIdentifiers, normalizeAuthoringIdentifiers} from './authoring-identifiers.ts';

function shortGoal(): CoursePackage {
  const course = structuredClone(quadraticFunctionsFixture) as CoursePackage;
  const old = course.learningGoals[0]!.id;
  course.learningGoals[0]!.id = 'g1';
  for (const unit of course.teachingUnits) unit.learningGoalIds = unit.learningGoalIds.map(id => id === old ? 'g1' : id);
  for (const assessment of course.assessments) assessment.learningGoalIds = assessment.learningGoalIds.map(id => id === old ? 'g1' : id);
  return course;
}
it('canonicalizes references without changing instructional text or the original value', () => {
  const candidate = shortGoal();
  candidate.teachingUnits[0]!.speechText = 'g1';
  const result = normalizeAuthoringIdentifiers(candidate);
  expect(result.learningGoals[0]!.id).toBe('generated.g1');
  expect(result.teachingUnits[0]!.learningGoalIds).toContain('generated.g1');
  expect(result.teachingUnits[0]!.speechText).toBe('g1');
  expect(candidate.learningGoals[0]!.id).toBe('g1');
  expect(() => parseCoursePackage(result)).not.toThrow();
});
it('avoids collisions with existing identifiers', () => {
  const candidate = shortGoal();
  candidate.concepts[0]!.id = 'generated.g1';
  const result = normalizeAuthoringIdentifiers(candidate);
  expect(result.learningGoals[0]!.id).toBe('generated.g1.id');
  expect(result.teachingUnits[0]!.learningGoalIds).toContain('generated.g1.id');
  expect(result.concepts[0]!.id).toBe('generated.g1');
});
it('does not invent missing targets or repair invalid or duplicate identifiers', () => {
  const missing = shortGoal();missing.teachingUnits[0]!.focusTargetIds = ['x'];
  expect(() => parseCoursePackage(normalizeAuthoringIdentifiers(missing))).toThrow();
  for (const id of ['', '../bad', 'UPPER']) {
    const invalid = shortGoal();invalid.learningGoals[0]!.id = id;
    expect(() => parseCoursePackage(normalizeAuthoringIdentifiers(invalid))).toThrow();
  }
  const duplicate = shortGoal();duplicate.learningGoals.push({...duplicate.learningGoals[0]!});
  expect(() => parseCoursePackage(normalizeAuthoringIdentifiers(duplicate))).toThrow();
});
it('relaxes only generated identifier length, keeping the persisted contract strict', () => {
  const schema = JSON.parse(JSON.stringify(CoursePackageSchema));
  allowShortAuthoringIdentifiers(schema);
  expect(schema.properties.learningGoals.items.properties.id.minLength).toBe(1);
  expect(schema.properties.learningGoals.items.properties.id.pattern).toBe('^[a-z][a-z0-9._:-]*$');
  expect(CoursePackageSchema.properties.learningGoals.items.properties.id.minLength).toBe(3);
});
