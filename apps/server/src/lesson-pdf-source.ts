import type { ReadonlyCoursePackage } from "@aituber/contracts";

/** Resolve only from the authenticated session's immutable course, never a caller's path/hash. */
export function lessonPdfSource(course: ReadonlyCoursePackage, sourceId: string) {
  const source = course.sources.find(source => source.id === sourceId);
  if (!source || source.kind !== "pdf") throw new RangeError("Unknown PDF source for this lesson");
  return source;
}

export const pdfSourceHeaders = {
  "content-type": "application/pdf",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};
