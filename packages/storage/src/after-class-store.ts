import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export interface StoredAfterClassAnswer {
  readonly id: string; readonly sessionId: string; readonly questionId: string; readonly questionText: string;
  readonly status: "preparing" | "available" | "unanswered"; readonly answerText: string | null;
  readonly sourceIds: readonly string[]; readonly knowledgeBasis: "course" | "general" | null;
  readonly failure: string | null; readonly attempts: number; readonly createdAt: string; readonly updatedAt: string;
}
export interface StoredAfterClassAttempt { readonly answerId: string; readonly attempt: number; readonly candidate: unknown; readonly review: unknown; readonly failure: string | null; readonly createdAt: string }
export interface StoredAfterClassSurvey { readonly id: string; readonly sessionId: string; readonly participantId: string; readonly questionHelpfulness: number; readonly rejoinNaturalness: number; readonly comment: string; readonly submittedAt: string }

interface AnswerRow { id: string; session_id: string; question_id: string; question_text: string; status: StoredAfterClassAnswer["status"]; answer_text: string | null; source_ids_json: string; knowledge_basis: StoredAfterClassAnswer["knowledgeBasis"]; failure: string | null; attempts: number; created_at: string; updated_at: string }
interface AttemptRow { answer_id: string; attempt: number; candidate_json: string; review_json: string; failure: string | null; created_at: string }
interface SurveyRow { id: string; session_id: string; participant_id: string; question_helpfulness: number; rejoin_naturalness: number; comment: string; submitted_at: string }

export class AfterClassStore {
  readonly #database: Database.Database;
  constructor(readonly databasePath: string) { this.#database = new Database(databasePath); this.#database.pragma("foreign_keys = ON"); this.#database.pragma("journal_mode = WAL"); this.#database.pragma("synchronous = FULL"); this.#migrate(); }
  close() { this.#database.close(); }

  begin(input: { readonly sessionId: string; readonly questionId: string; readonly questionText: string; readonly createdAt?: string }): StoredAfterClassAnswer {
    const id = `after-class.${randomUUID()}`; const now = input.createdAt ?? new Date().toISOString();
    this.#database.prepare("INSERT INTO after_class_answers (id, session_id, question_id, question_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'preparing', ?, ?)").run(id, input.sessionId, input.questionId, input.questionText, now, now);
    return this.getAnswer(id);
  }
  recordAttempt(input: { readonly answerId: string; readonly attempt: number; readonly candidate: unknown; readonly review: unknown; readonly failure: string | null; readonly createdAt?: string }) {
    const now = input.createdAt ?? new Date().toISOString();
    this.#database.transaction(() => {
      this.#database.prepare("INSERT INTO after_class_answer_attempts (answer_id, attempt, candidate_json, review_json, failure, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(input.answerId, input.attempt, JSON.stringify(input.candidate), JSON.stringify(input.review), input.failure, now);
      this.#database.prepare("UPDATE after_class_answers SET attempts = ?, updated_at = ? WHERE id = ?").run(input.attempt, now, input.answerId);
    })();
  }
  finish(input: { readonly id: string; readonly status: "available" | "unanswered"; readonly answerText?: string | null; readonly sourceIds?: readonly string[]; readonly knowledgeBasis?: "course" | "general" | null; readonly failure?: string | null; readonly updatedAt?: string }): StoredAfterClassAnswer {
    const now = input.updatedAt ?? new Date().toISOString();
    this.#database.prepare("UPDATE after_class_answers SET status = ?, answer_text = ?, source_ids_json = ?, knowledge_basis = ?, failure = ?, updated_at = ? WHERE id = ?").run(input.status, input.answerText ?? null, JSON.stringify(input.sourceIds ?? []), input.knowledgeBasis ?? null, input.failure ?? null, now, input.id);
    return this.getAnswer(input.id);
  }
  getAnswer(id: string): StoredAfterClassAnswer { const row = this.#database.prepare("SELECT * FROM after_class_answers WHERE id = ?").get(id) as AnswerRow | undefined; if (!row) throw new RangeError("Unknown after-class answer"); return mapAnswer(row); }
  listAnswers(sessionId: string): readonly StoredAfterClassAnswer[] { return (this.#database.prepare("SELECT * FROM after_class_answers WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as AnswerRow[]).map(mapAnswer); }
  listAttempts(answerId: string): readonly StoredAfterClassAttempt[] { return (this.#database.prepare("SELECT * FROM after_class_answer_attempts WHERE answer_id = ? ORDER BY attempt ASC").all(answerId) as AttemptRow[]).map((row) => ({ answerId: row.answer_id, attempt: row.attempt, candidate: JSON.parse(row.candidate_json), review: JSON.parse(row.review_json), failure: row.failure, createdAt: row.created_at })); }

  submitSurvey(input: Omit<StoredAfterClassSurvey, "id" | "submittedAt"> & { readonly submittedAt?: string }): StoredAfterClassSurvey {
    const id = `survey.${randomUUID()}`; const now = input.submittedAt ?? new Date().toISOString();
    this.#database.prepare(`INSERT INTO after_class_surveys (id, session_id, participant_id, question_helpfulness, rejoin_naturalness, comment, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, participant_id) DO UPDATE SET question_helpfulness = excluded.question_helpfulness, rejoin_naturalness = excluded.rejoin_naturalness, comment = excluded.comment, submitted_at = excluded.submitted_at`).run(id, input.sessionId, input.participantId, input.questionHelpfulness, input.rejoinNaturalness, input.comment, now);
    return this.getSurvey(input.sessionId, input.participantId)!;
  }
  getSurvey(sessionId: string, participantId: string): StoredAfterClassSurvey | null { const row = this.#database.prepare("SELECT * FROM after_class_surveys WHERE session_id = ? AND participant_id = ?").get(sessionId, participantId) as SurveyRow | undefined; return row ? mapSurvey(row) : null; }

  #migrate() { this.#database.exec(`CREATE TABLE IF NOT EXISTS after_class_answers (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, question_id TEXT NOT NULL UNIQUE, question_text TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('preparing','available','unanswered')), answer_text TEXT,
      source_ids_json TEXT NOT NULL DEFAULT '[]', knowledge_basis TEXT CHECK(knowledge_basis IN ('course','general')),
      failure TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS after_class_answers_session ON after_class_answers(session_id, created_at);
    CREATE TABLE IF NOT EXISTS after_class_answer_attempts (
      answer_id TEXT NOT NULL REFERENCES after_class_answers(id) ON DELETE CASCADE, attempt INTEGER NOT NULL,
      candidate_json TEXT NOT NULL, review_json TEXT NOT NULL, failure TEXT, created_at TEXT NOT NULL, PRIMARY KEY(answer_id, attempt)
    );
    CREATE TABLE IF NOT EXISTS after_class_surveys (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, participant_id TEXT NOT NULL,
      question_helpfulness INTEGER NOT NULL CHECK(question_helpfulness BETWEEN 1 AND 5),
      rejoin_naturalness INTEGER NOT NULL CHECK(rejoin_naturalness BETWEEN 1 AND 5),
      comment TEXT NOT NULL, submitted_at TEXT NOT NULL, UNIQUE(session_id, participant_id)
    );`); }
}

function mapAnswer(row: AnswerRow): StoredAfterClassAnswer { return { id: row.id, sessionId: row.session_id, questionId: row.question_id, questionText: row.question_text, status: row.status, answerText: row.answer_text, sourceIds: JSON.parse(row.source_ids_json) as string[], knowledgeBasis: row.knowledge_basis, failure: row.failure, attempts: row.attempts, createdAt: row.created_at, updatedAt: row.updated_at }; }
function mapSurvey(row: SurveyRow): StoredAfterClassSurvey { return { id: row.id, sessionId: row.session_id, participantId: row.participant_id, questionHelpfulness: row.question_helpfulness, rejoinNaturalness: row.rejoin_naturalness, comment: row.comment, submittedAt: row.submitted_at }; }
