import Database from "better-sqlite3";

export interface LectureSession {
  readonly id: string;
  readonly coursePackageId: string;
  readonly coursePackageVersion: number;
  readonly epoch: number;
  readonly lastSeq: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LectureEvent<Payload = unknown> {
  readonly eventId: string;
  readonly sessionId: string;
  readonly coursePackageId: string;
  readonly coursePackageVersion: number;
  readonly epoch: number;
  readonly seq: number;
  readonly occurredAt: string;
  readonly type: string;
  readonly payload: Payload;
}

interface SessionRow {
  id: string;
  course_package_id: string;
  course_package_version: number;
  epoch: number;
  last_seq: number;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  event_id: string;
  session_id: string;
  course_package_id: string;
  course_package_version: number;
  epoch: number;
  seq: number;
  occurred_at: string;
  type: string;
  payload_json: string;
}

interface SnapshotRow {
  epoch: number;
  seq: number;
  state_json: string;
}

export class EventStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventStoreConflictError";
  }
}

export class LectureEventStore {
  readonly #database: Database.Database;

  constructor(readonly databasePath: string) {
    this.#database = new Database(databasePath);
    this.#database.pragma("foreign_keys = ON");
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("synchronous = FULL");
    this.#migrate();
  }

  close() {
    this.#database.close();
  }

  createSession(input: {
    id: string;
    coursePackageId: string;
    coursePackageVersion: number;
    createdAt?: string;
  }): LectureSession {
    assertIdentifier(input.id, "session id");
    assertIdentifier(input.coursePackageId, "Course Package id");
    assertPositiveInteger(input.coursePackageVersion, "Course Package version");
    const now = input.createdAt ?? new Date().toISOString();
    assertTimestamp(now, "createdAt");

    this.#database.prepare(`
      INSERT INTO lecture_sessions (
        id, course_package_id, course_package_version, epoch, last_seq, created_at, updated_at
      ) VALUES (?, ?, ?, 1, 0, ?, ?)
    `).run(input.id, input.coursePackageId, input.coursePackageVersion, now, now);
    return this.getSession(input.id);
  }

  getSession(sessionId: string): LectureSession {
    const row = this.#database.prepare("SELECT * FROM lecture_sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
    if (!row) throw new EventStoreConflictError(`Unknown session ${sessionId}`);
    return mapSession(row);
  }

  appendEvent(event: LectureEvent): { inserted: boolean; event: LectureEvent } {
    validateEvent(event);
    const payloadJson = serializeJson(event.payload);

    return this.#database.transaction(() => {
      const duplicate = this.#database.prepare("SELECT * FROM lecture_events WHERE event_id = ?").get(event.eventId) as EventRow | undefined;
      if (duplicate) {
        const stored = mapEvent(duplicate);
        if (stableStringify(stored) !== stableStringify(event)) {
          throw new EventStoreConflictError(`Event id ${event.eventId} already has different content`);
        }
        return { inserted: false, event: stored };
      }

      const session = this.getSession(event.sessionId);
      if (event.coursePackageId !== session.coursePackageId || event.coursePackageVersion !== session.coursePackageVersion) {
        throw new EventStoreConflictError("Event Course Package does not match the session");
      }
      if (event.epoch !== session.epoch) {
        throw new EventStoreConflictError(`Expected epoch ${session.epoch}, received ${event.epoch}`);
      }
      if (event.seq !== session.lastSeq + 1) {
        throw new EventStoreConflictError(`Expected seq ${session.lastSeq + 1}, received ${event.seq}`);
      }

      this.#database.prepare(`
        INSERT INTO lecture_events (
          event_id, session_id, course_package_id, course_package_version,
          epoch, seq, occurred_at, type, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.eventId,
        event.sessionId,
        event.coursePackageId,
        event.coursePackageVersion,
        event.epoch,
        event.seq,
        event.occurredAt,
        event.type,
        payloadJson,
      );
      this.#database.prepare(`
        UPDATE lecture_sessions SET last_seq = ?, updated_at = ? WHERE id = ?
      `).run(event.seq, event.occurredAt, event.sessionId);
      return { inserted: true, event: structuredClone(event) };
    })();
  }

  advanceEpoch(sessionId: string, occurredAt = new Date().toISOString()): LectureSession {
    assertTimestamp(occurredAt, "occurredAt");
    this.#database.prepare(`
      UPDATE lecture_sessions SET epoch = epoch + 1, last_seq = 0, updated_at = ? WHERE id = ?
    `).run(occurredAt, sessionId);
    return this.getSession(sessionId);
  }

  saveSnapshot<State>(sessionId: string, state: State): void {
    const session = this.getSession(sessionId);
    this.#database.prepare(`
      INSERT INTO lecture_snapshots (
        session_id, course_package_id, course_package_version, epoch, seq, state_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, epoch, seq) DO UPDATE SET state_json = excluded.state_json
    `).run(
      session.id,
      session.coursePackageId,
      session.coursePackageVersion,
      session.epoch,
      session.lastSeq,
      serializeJson(state),
      new Date().toISOString(),
    );
  }

  loadEvents(sessionId: string): readonly LectureEvent[] {
    const rows = this.#database.prepare(`
      SELECT * FROM lecture_events WHERE session_id = ? ORDER BY epoch ASC, seq ASC
    `).all(sessionId) as EventRow[];
    return rows.map(mapEvent);
  }

  replay<State>(sessionId: string, initialState: State, reduce: (state: State, event: LectureEvent) => State): State {
    const snapshot = this.#database.prepare(`
      SELECT epoch, seq, state_json FROM lecture_snapshots
      WHERE session_id = ? ORDER BY epoch DESC, seq DESC LIMIT 1
    `).get(sessionId) as SnapshotRow | undefined;
    let state = snapshot ? (JSON.parse(snapshot.state_json) as State) : structuredClone(initialState);
    const epoch = snapshot?.epoch ?? 0;
    const seq = snapshot?.seq ?? 0;
    const rows = this.#database.prepare(`
      SELECT * FROM lecture_events
      WHERE session_id = ? AND (epoch > ? OR (epoch = ? AND seq > ?))
      ORDER BY epoch ASC, seq ASC
    `).all(sessionId, epoch, epoch, seq) as EventRow[];
    for (const row of rows) state = reduce(state, mapEvent(row));
    return state;
  }

  async backup(destinationPath: string): Promise<void> {
    await this.#database.backup(destinationPath);
  }

  #migrate() {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS lecture_sessions (
        id TEXT PRIMARY KEY,
        course_package_id TEXT NOT NULL,
        course_package_version INTEGER NOT NULL CHECK(course_package_version > 0),
        epoch INTEGER NOT NULL CHECK(epoch > 0),
        last_seq INTEGER NOT NULL CHECK(last_seq >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lecture_events (
        event_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
        course_package_id TEXT NOT NULL,
        course_package_version INTEGER NOT NULL,
        epoch INTEGER NOT NULL CHECK(epoch > 0),
        seq INTEGER NOT NULL CHECK(seq > 0),
        occurred_at TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE(session_id, epoch, seq)
      );
      CREATE TABLE IF NOT EXISTS lecture_snapshots (
        session_id TEXT NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
        course_package_id TEXT NOT NULL,
        course_package_version INTEGER NOT NULL,
        epoch INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(session_id, epoch, seq)
      );
    `);
  }
}

function validateEvent(event: LectureEvent) {
  assertIdentifier(event.eventId, "event id");
  assertIdentifier(event.sessionId, "session id");
  assertIdentifier(event.coursePackageId, "Course Package id");
  assertPositiveInteger(event.coursePackageVersion, "Course Package version");
  assertPositiveInteger(event.epoch, "epoch");
  assertPositiveInteger(event.seq, "seq");
  assertTimestamp(event.occurredAt, "occurredAt");
  if (!event.type || event.type.length > 128) throw new TypeError("event type must contain 1 to 128 characters");
}

function assertIdentifier(value: string, name: string) {
  if (!/^[a-z][a-z0-9._:-]{2,127}$/.test(value)) throw new TypeError(`${name} is invalid`);
}

function assertPositiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
}

function assertTimestamp(value: string, name: string) {
  if (!value || Number.isNaN(Date.parse(value))) throw new TypeError(`${name} must be an ISO timestamp`);
}

function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Value must be JSON serializable");
  return serialized;
}

function mapSession(row: SessionRow): LectureSession {
  return {
    id: row.id,
    coursePackageId: row.course_package_id,
    coursePackageVersion: row.course_package_version,
    epoch: row.epoch,
    lastSeq: row.last_seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventRow): LectureEvent {
  return {
    eventId: row.event_id,
    sessionId: row.session_id,
    coursePackageId: row.course_package_id,
    coursePackageVersion: row.course_package_version,
    epoch: row.epoch,
    seq: row.seq,
    occurredAt: row.occurred_at,
    type: row.type,
    payload: JSON.parse(row.payload_json) as unknown,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
