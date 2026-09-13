import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export interface StoredQuestionThread {
  readonly id: string;
  readonly sessionId: string;
  readonly coursePackageId: string;
  readonly coursePackageVersion: number;
  readonly sceneId: string;
  readonly semanticTargetId: string;
  readonly lastCompletedUnitId: string | null;
  readonly text: string;
  readonly normalizedIntent: string;
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly supporterCount: number;
  readonly participantIds: readonly string[];
  readonly status: "accepted" | "answering" | "answered";
  readonly resolution: "pending" | "answered" | "deferred";
  readonly disposition: "answer-now" | "after-class";
  readonly reason: string;
  readonly priority: { readonly score: number; readonly currentGoalRelated: boolean; readonly prerequisiteForNext: boolean; readonly supporterCount: number; readonly waitedMs: number; readonly remainingMs: number };
  readonly origin: "learner-question" | "pedagogy-trigger";
}

interface QuestionRow {
  id: string; session_id: string; course_package_id: string; course_package_version: number; scene_id: string; semantic_target_id: string;
  last_completed_unit_id: string | null; text: string; normalized_intent: string; submitted_at: string; updated_at: string;
  status: StoredQuestionThread["status"]; resolution: StoredQuestionThread["resolution"]; disposition: StoredQuestionThread["disposition"]; reason: string; priority_score: number;
  current_goal_related: number; prerequisite_for_next: number; waited_ms: number; remaining_ms: number; supporter_count: number; participant_ids: string;
  origin: StoredQuestionThread["origin"];
}

export class QuestionStore {
  readonly #database: Database.Database;

  constructor(readonly databasePath: string) { this.#database = new Database(databasePath); this.#database.pragma("foreign_keys = ON"); this.#database.pragma("journal_mode = WAL"); this.#database.pragma("synchronous = FULL"); this.#migrate(); }
  close() { this.#database.close(); }

  create(input: Omit<StoredQuestionThread, "id" | "updatedAt" | "supporterCount" | "participantIds" | "status" | "resolution" | "disposition" | "reason" | "priority" | "origin"> & { readonly participantId: string; readonly origin?: StoredQuestionThread["origin"] }): StoredQuestionThread {
    const id = `question.${randomUUID()}`;
    this.#database.transaction(() => {
      this.#database.prepare(`INSERT INTO question_threads (id, session_id, course_package_id, course_package_version, scene_id, semantic_target_id, last_completed_unit_id, text, normalized_intent, submitted_at, updated_at, status, disposition, reason, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', 'answer-now', '受付順に回答します。', ?)`).run(id, input.sessionId, input.coursePackageId, input.coursePackageVersion, input.sceneId, input.semanticTargetId, input.lastCompletedUnitId, input.text, input.normalizedIntent, input.submittedAt, input.submittedAt, input.origin ?? "learner-question");
      this.#insertSubmission(id, input.participantId, input.text, input.submittedAt);
    })();
    return this.get(id);
  }

  support(questionId: string, participantId: string, text: string, submittedAt: string): StoredQuestionThread {
    this.#database.transaction(() => { this.#insertSubmission(questionId, participantId, text, submittedAt); this.#database.prepare("UPDATE question_threads SET updated_at = ? WHERE id = ?").run(submittedAt, questionId); })();
    return this.get(questionId);
  }

  get(id: string): StoredQuestionThread {
    const row = this.#query("WHERE q.id = ?").get(id) as QuestionRow | undefined;
    if (!row) throw new RangeError("Unknown question");
    return mapQuestion(row);
  }

  list(sessionId: string): readonly StoredQuestionThread[] { return (this.#query("WHERE q.session_id = ?", "ORDER BY q.submitted_at ASC").all(sessionId) as QuestionRow[]).map(mapQuestion); }
  listOpen(sessionId: string): readonly StoredQuestionThread[] { return (this.#query("WHERE q.session_id = ? AND q.resolution = 'pending'", "ORDER BY q.submitted_at ASC").all(sessionId) as QuestionRow[]).map(mapQuestion); }

  updateProcessing(id: string, status: StoredQuestionThread["status"], updatedAt = new Date().toISOString()): StoredQuestionThread {
    this.#database.prepare("UPDATE question_threads SET status = ?, updated_at = ? WHERE id = ?").run(status, updatedAt, id);
    return this.get(id);
  }

  resolve(id: string, resolution: Exclude<StoredQuestionThread["resolution"], "pending">, reason: string, updatedAt = new Date().toISOString()): StoredQuestionThread {
    const status: StoredQuestionThread["status"] = resolution === "answered" ? "answered" : "accepted";
    this.#database.prepare("UPDATE question_threads SET status = ?, resolution = ?, disposition = 'after-class', reason = ?, updated_at = ? WHERE id = ?").run(status, resolution, reason, updatedAt, id);
    return this.get(id);
  }

  updateClassifications(updates: readonly { readonly id: string; readonly disposition: StoredQuestionThread["disposition"]; readonly reason: string; readonly priority: StoredQuestionThread["priority"]; readonly updatedAt: string }[]) {
    const statement = this.#database.prepare("UPDATE question_threads SET disposition = ?, reason = ?, priority_score = ?, current_goal_related = ?, prerequisite_for_next = ?, waited_ms = ?, remaining_ms = ?, updated_at = ? WHERE id = ?");
    this.#database.transaction(() => { for (const update of updates) statement.run(update.disposition, update.reason, update.priority.score, Number(update.priority.currentGoalRelated), Number(update.priority.prerequisiteForNext), update.priority.waitedMs, update.priority.remainingMs, update.updatedAt, update.id); })();
  }

  #insertSubmission(questionId: string, participantId: string, text: string, submittedAt: string) { this.#database.prepare("INSERT INTO question_submissions (id, question_id, participant_id, text, submitted_at) VALUES (?, ?, ?, ?, ?)").run(`submission.${randomUUID()}`, questionId, participantId, text, submittedAt); }
  #query(where: string, order = "") { return this.#database.prepare(`SELECT q.*, COUNT(DISTINCT s.participant_id) AS supporter_count, GROUP_CONCAT(DISTINCT s.participant_id) AS participant_ids FROM question_threads q JOIN question_submissions s ON s.question_id = q.id ${where} GROUP BY q.id ${order}`); }
  #migrate() { this.#database.exec(`
    CREATE TABLE IF NOT EXISTS question_threads (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, course_package_id TEXT NOT NULL, course_package_version INTEGER NOT NULL,
      scene_id TEXT NOT NULL, semantic_target_id TEXT NOT NULL, last_completed_unit_id TEXT, text TEXT NOT NULL, normalized_intent TEXT NOT NULL,
      submitted_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('accepted','answering','answered')),
      disposition TEXT NOT NULL CHECK(disposition IN ('answer-now','after-class')), reason TEXT NOT NULL,
      priority_score REAL NOT NULL DEFAULT 0, current_goal_related INTEGER NOT NULL DEFAULT 0, prerequisite_for_next INTEGER NOT NULL DEFAULT 0,
      waited_ms INTEGER NOT NULL DEFAULT 0, remaining_ms INTEGER NOT NULL DEFAULT 0,
      origin TEXT NOT NULL DEFAULT 'learner-question' CHECK(origin IN ('learner-question','pedagogy-trigger'))
    );
    CREATE INDEX IF NOT EXISTS question_threads_session_status ON question_threads(session_id, status, submitted_at);
    CREATE TABLE IF NOT EXISTS question_submissions (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES question_threads(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL, text TEXT NOT NULL, submitted_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS question_submissions_question ON question_submissions(question_id, participant_id);
  `); const columns = this.#database.prepare("PRAGMA table_info(question_threads)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "resolution")) this.#database.exec("ALTER TABLE question_threads ADD COLUMN resolution TEXT NOT NULL DEFAULT 'pending' CHECK(resolution IN ('pending','answered','deferred'))");
    if (!columns.some((column) => column.name === "origin")) this.#database.exec("ALTER TABLE question_threads ADD COLUMN origin TEXT NOT NULL DEFAULT 'learner-question' CHECK(origin IN ('learner-question','pedagogy-trigger'))"); }
}

function mapQuestion(row: QuestionRow): StoredQuestionThread {
  const participantIds = row.participant_ids ? row.participant_ids.split(",") : [];
  return { id: row.id, sessionId: row.session_id, coursePackageId: row.course_package_id, coursePackageVersion: row.course_package_version, sceneId: row.scene_id, semanticTargetId: row.semantic_target_id, lastCompletedUnitId: row.last_completed_unit_id, text: row.text, normalizedIntent: row.normalized_intent, submittedAt: row.submitted_at, updatedAt: row.updated_at, supporterCount: row.supporter_count, participantIds, status: row.status, resolution: row.resolution, disposition: row.disposition, reason: row.reason, priority: { score: row.priority_score, currentGoalRelated: Boolean(row.current_goal_related), prerequisiteForNext: Boolean(row.prerequisite_for_next), supporterCount: row.supporter_count, waitedMs: row.waited_ms, remainingMs: row.remaining_ms }, origin: row.origin };
}
