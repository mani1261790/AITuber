import type {CoursePackage} from './course-package.ts';
export interface PackageDraft {
 course:CoursePackage;
 revision:string;
 baseHash:string;
 status:'draft'|'queued'|'reviewing'|'published'|'failed';
 error:string|null;
}
