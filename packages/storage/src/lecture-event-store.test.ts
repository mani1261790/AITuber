import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStoreConflictError, LectureEventStore, type LectureEvent } from "./lecture-event-store.ts";

let directory: string;
let databasePath: string;
let store: LectureEventStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "aituber-storage-"));
  databasePath = join(directory, "events.db");
  store = new LectureEventStore(databasePath);
  store.createSession({
    id: "session.test",
    coursePackageId: "course.test",
    coursePackageVersion: 1,
    createdAt: "2026-09-14T00:00:00.000Z",
  });
});

afterEach(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});

function event(seq: number, payload: unknown = { amount: 1 }): LectureEvent {
  return {
    eventId: `event.e${seq}`,
    sessionId: "session.test",
    coursePackageId: "course.test",
    coursePackageVersion: 1,
    epoch: 1,
    seq,
    occurredAt: `2026-09-14T00:00:0${seq}.000Z`,
    type: "counter.incremented",
    payload,
  };
}

describe("LectureEventStore", () => {
  it("stores a complete event envelope and ignores an identical retry", () => {
    expect(store.appendEvent(event(1)).inserted).toBe(true);
    expect(store.appendEvent(event(1)).inserted).toBe(false);
    expect(store.loadEvents("session.test")).toEqual([event(1)]);
    expect(store.getSession("session.test").lastSeq).toBe(1);
  });

  it("rejects reused ids, sequence gaps, and stale epochs", () => {
    store.appendEvent(event(1));
    expect(() => store.appendEvent({ ...event(1), payload: { amount: 2 } })).toThrow(EventStoreConflictError);
    expect(() => store.appendEvent(event(3))).toThrow("Expected seq 2");
    store.advanceEpoch("session.test", "2026-09-14T00:00:10.000Z");
    expect(() => store.appendEvent({ ...event(2), seq: 1 })).toThrow("Expected epoch 2");
  });

  it("replays from the latest snapshot and later epochs", () => {
    store.appendEvent(event(1));
    store.saveSnapshot("session.test", { count: 1 });
    store.appendEvent(event(2, { amount: 2 }));
    store.advanceEpoch("session.test", "2026-09-14T00:00:10.000Z");
    store.appendEvent({ ...event(1, { amount: 4 }), eventId: "event.epoch2", epoch: 2 });

    const result = store.replay("session.test", { count: 0 }, (state, storedEvent) => ({
      count: state.count + (storedEvent.payload as { amount: number }).amount,
    }));
    expect(result).toEqual({ count: 7 });
  });

  it("rolls back the session sequence when the event insert fails", () => {
    const sabotage = new Database(databasePath);
    sabotage.exec(`
      CREATE TRIGGER reject_events BEFORE INSERT ON lecture_events
      BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;
    `);
    sabotage.close();

    expect(() => store.appendEvent(event(1))).toThrow("injected write failure");
    expect(store.getSession("session.test").lastSeq).toBe(0);
    expect(store.loadEvents("session.test")).toEqual([]);
  });

  it("creates a consistent online backup while WAL mode is active", async () => {
    store.appendEvent(event(1));
    store.saveSnapshot("session.test", { count: 1 });
    const backupPath = join(directory, "backup.db");
    await store.backup(backupPath);

    const backup = new LectureEventStore(backupPath);
    expect(backup.getSession("session.test").lastSeq).toBe(1);
    expect(backup.loadEvents("session.test")).toEqual([event(1)]);
    expect(backup.replay("session.test", { count: 0 }, (state) => state)).toEqual({ count: 1 });
    backup.close();
  });
});
