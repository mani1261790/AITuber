import { describe, expect, it } from "vitest";
import { createStudyRecord, recordStudyWithPrompts, renderSummary, summarizeStudy, validateCompleteRecord, type StudyRecord } from "./usability-study.ts";

describe("usability study", () => {
  it("counterbalances both high-school courses and the university course", () => {
    const first = createStudyRecord("p01", new Date("2026-09-14T00:00:00Z"));
    const second = createStudyRecord("p02", new Date("2026-09-14T00:00:00Z"));
    expect(first.sessions.map((session) => session.courseId)).toEqual(["course.quadratic-functions", "course.vae-reparameterization"]);
    expect(second.sessions.map((session) => session.courseId)).toEqual(["course.vae-reparameterization", "course.dna-replication"]);
  });

  it("requires recorded consent and complete task results", () => {
    expect(() => validateCompleteRecord(createStudyRecord("p01"))).toThrow("consent is incomplete");
  });

  it("records consent and both assigned sessions through fixed prompts", async () => {
    const answers = ["y", "y", ...sessionAnswers("AB12CD"), ...sessionAnswers("EF34GH"), "n"];
    const record = await recordStudyWithPrompts(createStudyRecord("p01"), async () => answers.shift() ?? "", new Date("2026-09-14T01:00:00Z"));
    expect(record.consent.consentedAt).toBe("2026-09-14T01:00:00.000Z");
    expect(record.sessions.map((session) => session.classroomCode)).toEqual(["AB12CD", "EF34GH"]);
    expect(record.sessions.every((session) => session.tasks.reconnect.success)).toBe(true);
  });

  it("leaves the draft untouched when consent is not provided", async () => {
    const draft = createStudyRecord("p01"); const answers = ["y", "n"];
    await expect(recordStudyWithPrompts(draft, async () => answers.shift() ?? "")).rejects.toThrow("Consent was not provided");
    expect(draft.consent.agreed).toBe(false);
  });

  it("passes a complete six-person round and blocks release for an open blocker", () => {
    const records = Array.from({ length: 6 }, (_, index) => completeRecord(`p0${index + 1}`));
    const passed = summarizeStudy(records);
    expect(passed.readyForPublicRelease).toBe(true);
    expect(passed.taskSuccess.reconnect).toBe(1);
    expect(renderSummary(passed)).toContain("公開準備へ進める");

    const blockedRecord = structuredClone(records[0]) as Mutable<StudyRecord>;
    blockedRecord.incidents.push({ severity: "blocking", status: "open", summary: "再接続後に操作不能", issue: 101 });
    const blocked = summarizeStudy([blockedRecord, ...records.slice(1)]);
    expect(blocked.readyForPublicRelease).toBe(false);
    expect(renderSummary(blocked)).toContain("公開を保留する");
  });
});

type Mutable<T> = { -readonly [P in keyof T]: T[P] extends readonly (infer U)[] ? Mutable<U>[] : T[P] extends object ? Mutable<T[P]> : T[P] };

function completeRecord(participantId: string): StudyRecord {
  const record = structuredClone(createStudyRecord(participantId)) as Mutable<StudyRecord>;
  record.consent.adult18OrOlder = true; record.consent.agreed = true; record.consent.consentedAt = "2026-09-14T00:00:00Z";
  record.sessions.forEach((session, sessionIndex) => {
    session.classroomCode = `${participantId}-s${sessionIndex + 1}`;
    Object.values(session.tasks).forEach((task) => { task.success = true; task.assistanceCount = 0; });
    session.checkpointCorrect = true;
    Object.keys(session.ratings).forEach((key) => { session.ratings[key as keyof typeof session.ratings] = 4; });
  });
  return validateCompleteRecord(record);
}

function sessionAnswers(classroomCode: string) { return [classroomCode, "y", "0", "y", "0", "y", "0", "y", "0", "y", "4", "4", "4", "4"]; }
