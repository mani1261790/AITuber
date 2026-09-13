import Database from "better-sqlite3";

export interface RetentionPurgeResult { readonly sessions: number; readonly questions: number; readonly evidence: number; readonly supplements: number; readonly afterClassAnswers: number; readonly surveys: number; readonly usageReservations: number }

export class DataRetentionStore {
  readonly #database: Database.Database;
  constructor(databasePath: string) { this.#database = new Database(databasePath); this.#database.pragma("foreign_keys = ON"); this.#database.pragma("journal_mode = WAL"); this.#database.pragma("synchronous = FULL"); }
  close() { this.#database.close(); }

  purgeBefore(cutoff: string): RetentionPurgeResult {
    if (Number.isNaN(Date.parse(cutoff))) throw new TypeError("retention cutoff must be an ISO timestamp");
    return this.#database.transaction(() => {
      const expired = this.#database.prepare(`SELECT s.id FROM lecture_sessions s
        WHERE s.updated_at <= ?
          AND NOT EXISTS (SELECT 1 FROM question_threads q WHERE q.session_id = s.id AND q.updated_at > ?)
          AND NOT EXISTS (SELECT 1 FROM learning_evidence e WHERE e.session_id = s.id AND e.recorded_at > ?)
          AND NOT EXISTS (SELECT 1 FROM live_supplements l WHERE l.session_id = s.id AND l.updated_at > ?)
          AND NOT EXISTS (SELECT 1 FROM after_class_answers a WHERE a.session_id = s.id AND a.updated_at > ?)
          AND NOT EXISTS (SELECT 1 FROM after_class_surveys v WHERE v.session_id = s.id AND v.submitted_at > ?)`
      ).all(cutoff, cutoff, cutoff, cutoff, cutoff, cutoff) as { id: string }[];
      const ids = expired.map((row) => row.id);
      let questions = 0; let evidence = 0; let supplements = 0; let afterClassAnswers = 0; let surveys = 0;
      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        const answerIds = (this.#database.prepare(`SELECT id FROM after_class_answers WHERE session_id IN (${placeholders})`).all(...ids) as { id: string }[]).map((row) => row.id);
        if (answerIds.length) this.#database.prepare(`DELETE FROM after_class_answer_attempts WHERE answer_id IN (${answerIds.map(() => "?").join(",")})`).run(...answerIds);
        afterClassAnswers = this.#database.prepare(`DELETE FROM after_class_answers WHERE session_id IN (${placeholders})`).run(...ids).changes;
        surveys = this.#database.prepare(`DELETE FROM after_class_surveys WHERE session_id IN (${placeholders})`).run(...ids).changes;
        const supplementIds = (this.#database.prepare(`SELECT id FROM live_supplements WHERE session_id IN (${placeholders})`).all(...ids) as { id: string }[]).map((row) => row.id);
        if (supplementIds.length) this.#database.prepare(`DELETE FROM live_supplement_attempts WHERE supplement_id IN (${supplementIds.map(() => "?").join(",")})`).run(...supplementIds);
        supplements = this.#database.prepare(`DELETE FROM live_supplements WHERE session_id IN (${placeholders})`).run(...ids).changes;
        const questionIds = (this.#database.prepare(`SELECT id FROM question_threads WHERE session_id IN (${placeholders})`).all(...ids) as { id: string }[]).map((row) => row.id);
        if (questionIds.length) this.#database.prepare(`DELETE FROM question_submissions WHERE question_id IN (${questionIds.map(() => "?").join(",")})`).run(...questionIds);
        questions = this.#database.prepare(`DELETE FROM question_threads WHERE session_id IN (${placeholders})`).run(...ids).changes;
        evidence = this.#database.prepare(`DELETE FROM learning_evidence WHERE session_id IN (${placeholders})`).run(...ids).changes;
        this.#database.prepare(`DELETE FROM lecture_snapshots WHERE session_id IN (${placeholders})`).run(...ids);
        this.#database.prepare(`DELETE FROM lecture_events WHERE session_id IN (${placeholders})`).run(...ids);
        this.#database.prepare(`DELETE FROM lecture_sessions WHERE id IN (${placeholders})`).run(...ids);
      }
      const usageReservations = this.#database.prepare("DELETE FROM usage_reservations WHERE requested_at <= ?").run(cutoff).changes;
      return { sessions: ids.length, questions, evidence, supplements, afterClassAnswers, surveys, usageReservations };
    }).immediate();
  }
}
