import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export interface StoredSupplementOrigin { readonly lastCompletedUnitId: string | null; readonly unfinishedUnitIds: readonly string[]; readonly nextUnitId: string | null; readonly displayUnitId: string | null; readonly questionTargetId: string; readonly remainingMs: number }
export interface StoredSupplementCandidate { readonly speechText: string; readonly captionText: string; readonly sceneId: string; readonly focusTargetIds: readonly string[]; readonly boardPatches: readonly { readonly operation: "show" | "replace"; readonly targetId: string; readonly content?: string }[]; readonly sourceIds: readonly string[]; readonly knowledgeBasis: "course" | "general"; readonly calculations: readonly { readonly operator: "add" | "subtract" | "multiply" | "divide"; readonly left: number; readonly right: number; readonly result: number }[]; readonly corrections: readonly { readonly targetId: string; readonly content: string; readonly rationale: string }[] }

export type LiveSupplementStatus = "preparing" | "bridging" | "ready" | "playing" | "rejoining" | "completed" | "deferred";
export type SupplementGateId = "sources" | "semantic-targets" | "content" | "board" | "calculations";
export interface StoredSupplementReview {
  readonly passed: boolean;
  readonly gates: readonly { readonly id: SupplementGateId; readonly passed: boolean; readonly rationale: string }[];
  readonly summary: string;
}
export interface StoredLiveSupplement {
  readonly id: string;
  readonly sessionId: string;
  readonly questionId: string;
  readonly status: LiveSupplementStatus;
  readonly attempt: number;
  readonly origin: StoredSupplementOrigin;
  readonly candidate: StoredSupplementCandidate | null;
  readonly failure: string | null;
  readonly adoptedAt: string;
  readonly firstAudioAt: string | null;
  readonly updatedAt: string;
}
export interface StoredSupplementAttempt {
  readonly supplementId: string;
  readonly attempt: number;
  readonly candidate: StoredSupplementCandidate | null;
  readonly review: StoredSupplementReview | null;
  readonly failure: string | null;
  readonly createdAt: string;
}

interface SupplementRow { id: string; session_id: string; question_id: string; status: LiveSupplementStatus; attempt: number; origin_json: string; candidate_json: string | null; failure: string | null; adopted_at: string; first_audio_at: string | null; updated_at: string }
interface AttemptRow { supplement_id: string; attempt: number; candidate_json: string | null; review_json: string | null; failure: string | null; created_at: string }

export class LiveSupplementStore {
  readonly #database: Database.Database;
  constructor(readonly databasePath: string) { this.#database = new Database(databasePath); this.#database.pragma("foreign_keys = ON"); this.#database.pragma("journal_mode = WAL"); this.#database.pragma("synchronous = FULL"); this.#migrate(); }
  close() { this.#database.close(); }

  create(input: { readonly sessionId: string; readonly questionId: string; readonly origin: StoredSupplementOrigin; readonly status?: LiveSupplementStatus; readonly adoptedAt?: string }): StoredLiveSupplement {
    const id = `supplement.${randomUUID()}`; const now = input.adoptedAt ?? new Date().toISOString();
    this.#database.prepare("INSERT INTO live_supplements (id, session_id, question_id, status, attempt, origin_json, adopted_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)").run(id, input.sessionId, input.questionId, input.status ?? "preparing", serialize(input.origin), now, now);
    return this.get(id);
  }

  recordAttempt(input: { readonly supplementId: string; readonly attempt: number; readonly candidate: StoredSupplementCandidate | null; readonly review: StoredSupplementReview | null; readonly failure: string | null; readonly createdAt?: string }): StoredLiveSupplement {
    const now = input.createdAt ?? new Date().toISOString();
    this.#database.transaction(() => {
      this.#database.prepare("INSERT INTO live_supplement_attempts (supplement_id, attempt, candidate_json, review_json, failure, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(input.supplementId, input.attempt, nullableJson(input.candidate), nullableJson(input.review), input.failure, now);
      this.#database.prepare("UPDATE live_supplements SET attempt = ?, candidate_json = ?, failure = ?, updated_at = ? WHERE id = ?").run(input.attempt, nullableJson(input.candidate), input.failure, now, input.supplementId);
    })();
    return this.get(input.supplementId);
  }

  update(input: { readonly id: string; readonly status: LiveSupplementStatus; readonly candidate?: StoredSupplementCandidate | null; readonly failure?: string | null; readonly firstAudioAt?: string | null; readonly updatedAt?: string }): StoredLiveSupplement {
    const current = this.get(input.id); const now = input.updatedAt ?? new Date().toISOString();
    this.#database.prepare("UPDATE live_supplements SET status = ?, candidate_json = ?, failure = ?, first_audio_at = ?, updated_at = ? WHERE id = ?").run(input.status, nullableJson(input.candidate === undefined ? current.candidate : input.candidate), input.failure === undefined ? current.failure : input.failure, input.firstAudioAt === undefined ? current.firstAudioAt : input.firstAudioAt, now, input.id);
    return this.get(input.id);
  }

  get(id: string): StoredLiveSupplement { const row = this.#database.prepare("SELECT * FROM live_supplements WHERE id = ?").get(id) as SupplementRow | undefined; if (!row) throw new RangeError(`Unknown live supplement ${id}`); return mapSupplement(row); }
  list(sessionId: string): readonly StoredLiveSupplement[] { return (this.#database.prepare("SELECT * FROM live_supplements WHERE session_id = ? ORDER BY adopted_at ASC").all(sessionId) as SupplementRow[]).map(mapSupplement); }
  listAttempts(supplementId: string): readonly StoredSupplementAttempt[] { return (this.#database.prepare("SELECT * FROM live_supplement_attempts WHERE supplement_id = ? ORDER BY attempt ASC").all(supplementId) as AttemptRow[]).map((row) => ({ supplementId: row.supplement_id, attempt: row.attempt, candidate: parseNullable(row.candidate_json), review: parseNullable(row.review_json), failure: row.failure, createdAt: row.created_at })); }

  #migrate() { this.#database.exec(`
    CREATE TABLE IF NOT EXISTS live_supplements (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, question_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('preparing','bridging','ready','playing','rejoining','completed','deferred')),
      attempt INTEGER NOT NULL DEFAULT 0, origin_json TEXT NOT NULL, candidate_json TEXT, failure TEXT,
      adopted_at TEXT NOT NULL, first_audio_at TEXT, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS live_supplements_session ON live_supplements(session_id, adopted_at);
    CREATE TABLE IF NOT EXISTS live_supplement_attempts (
      supplement_id TEXT NOT NULL REFERENCES live_supplements(id) ON DELETE CASCADE,
      attempt INTEGER NOT NULL, candidate_json TEXT, review_json TEXT, failure TEXT, created_at TEXT NOT NULL,
      PRIMARY KEY(supplement_id, attempt)
    );
  `); }
}

function mapSupplement(row: SupplementRow): StoredLiveSupplement { return { id: row.id, sessionId: row.session_id, questionId: row.question_id, status: row.status, attempt: row.attempt, origin: JSON.parse(row.origin_json) as StoredSupplementOrigin, candidate: parseNullable(row.candidate_json), failure: row.failure, adoptedAt: row.adopted_at, firstAudioAt: row.first_audio_at, updatedAt: row.updated_at }; }
function serialize(value: unknown): string { const result = JSON.stringify(value); if (result === undefined) throw new TypeError("Value must be JSON serializable"); return result; }
function nullableJson(value: unknown | null): string | null { return value === null ? null : serialize(value); }
function parseNullable<T>(value: string | null): T | null { return value === null ? null : JSON.parse(value) as T; }
