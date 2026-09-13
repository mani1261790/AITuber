import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export type LearningEvidenceKind = "learner-question" | "checkpoint-answer" | "self-report" | "explicit-action";

export type StoredEvidenceJudgment = "confirmed" | "struggle" | "support" | "unknown";

export interface StoredLearningEvidence {
  readonly id: string;
  readonly sessionId: string;
  readonly participantId: string | null;
  readonly kind: LearningEvidenceKind;
  readonly scopeId: string;
  readonly assessmentId: string | null;
  readonly semanticTargetId: string | null;
  readonly observedValue: string;
  readonly automaticJudgment: StoredEvidenceJudgment;
  readonly finalJudgment: StoredEvidenceJudgment;
  readonly rationale: string;
  readonly correction: string | null;
  readonly linkedSupplementId: string | null;
  readonly recordedAt: string;
}

interface EvidenceRow {
  id: string; session_id: string; participant_id: string | null; kind: LearningEvidenceKind; scope_id: string;
  assessment_id: string | null; semantic_target_id: string | null; observed_value: string;
  automatic_judgment: StoredEvidenceJudgment; final_judgment: StoredEvidenceJudgment; rationale: string;
  correction: string | null; linked_supplement_id: string | null; recorded_at: string;
}

export class LearningEvidenceStore {
  readonly #database: Database.Database;

  constructor(readonly databasePath: string) {
    this.#database = new Database(databasePath);
    this.#database.pragma("foreign_keys = ON");
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("synchronous = FULL");
    this.#migrate();
  }

  close() { this.#database.close(); }

  record(input: Omit<StoredLearningEvidence, "id" | "recordedAt"> & { readonly recordedAt?: string }): StoredLearningEvidence {
    const id = `evidence.${randomUUID()}`; const recordedAt = input.recordedAt ?? new Date().toISOString();
    this.#database.prepare(`INSERT INTO learning_evidence (
      id, session_id, participant_id, kind, scope_id, assessment_id, semantic_target_id, observed_value,
      automatic_judgment, final_judgment, rationale, correction, linked_supplement_id, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.sessionId, input.participantId, input.kind, input.scopeId, input.assessmentId, input.semanticTargetId,
      input.observedValue, input.automaticJudgment, input.finalJudgment, input.rationale, input.correction, input.linkedSupplementId, recordedAt,
    );
    return this.get(id);
  }

  correct(id: string, finalJudgment: StoredEvidenceJudgment, correction: string): StoredLearningEvidence {
    if (!correction.trim()) throw new TypeError("correction is required");
    this.#database.prepare("UPDATE learning_evidence SET final_judgment = ?, correction = ? WHERE id = ?").run(finalJudgment, correction.trim(), id);
    return this.get(id);
  }

  get(id: string): StoredLearningEvidence {
    const row = this.#database.prepare("SELECT * FROM learning_evidence WHERE id = ?").get(id) as EvidenceRow | undefined;
    if (!row) throw new RangeError("Unknown learning evidence");
    return mapEvidence(row);
  }

  list(sessionId: string): readonly StoredLearningEvidence[] {
    return (this.#database.prepare("SELECT * FROM learning_evidence WHERE session_id = ? ORDER BY recorded_at ASC, id ASC").all(sessionId) as EvidenceRow[]).map(mapEvidence);
  }

  #migrate() {
    this.#database.exec(`CREATE TABLE IF NOT EXISTS learning_evidence (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, participant_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('learner-question','checkpoint-answer','self-report','explicit-action')),
      scope_id TEXT NOT NULL, assessment_id TEXT, semantic_target_id TEXT, observed_value TEXT NOT NULL,
      automatic_judgment TEXT NOT NULL CHECK(automatic_judgment IN ('confirmed','struggle','support','unknown')),
      final_judgment TEXT NOT NULL CHECK(final_judgment IN ('confirmed','struggle','support','unknown')),
      rationale TEXT NOT NULL, correction TEXT, linked_supplement_id TEXT, recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS learning_evidence_session_scope ON learning_evidence(session_id, scope_id, recorded_at);`);
  }
}

function mapEvidence(row: EvidenceRow): StoredLearningEvidence {
  return { id: row.id, sessionId: row.session_id, participantId: row.participant_id, kind: row.kind, scopeId: row.scope_id,
    assessmentId: row.assessment_id, semanticTargetId: row.semantic_target_id, observedValue: row.observed_value,
    automaticJudgment: row.automatic_judgment, finalJudgment: row.final_judgment, rationale: row.rationale,
    correction: row.correction, linkedSupplementId: row.linked_supplement_id, recordedAt: row.recorded_at };
}
