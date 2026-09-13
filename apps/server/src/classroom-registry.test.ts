import { describe, expect, it } from "vitest";
import { ClassroomAccessError, ClassroomCapacityError, ClassroomRegistry, normalizeCode } from "./classroom-registry.ts";

describe("ClassroomRegistry", () => {
  it("creates a short unambiguous code and preserves an anonymous participant on reconnect", () => {
    const registry = new ClassroomRegistry();
    const room = registry.create("session.1");
    expect(room.code).toMatch(/^[23456789A-HJ-NP-Z]{6}$/);
    const joined = registry.join(room.code.toLowerCase());
    expect(joined.participant.id).toMatch(/^learner\./);
    expect(joined.participant.accessToken).not.toContain(joined.participant.id);
    expect(registry.authenticate(room.code, joined.participant.accessToken).participant.id).toBe(joined.participant.id);
    expect(normalizeCode(`${room.code.slice(0, 3)}-${room.code.slice(3)}`)).toBe(room.code);
  });

  it("limits a room to five participants without exposing their identities", () => {
    const registry = new ClassroomRegistry();
    const room = registry.create("session.1");
    for (let count = 1; count <= 5; count += 1) expect(registry.join(room.code).room.participantCount).toBe(count);
    expect(() => registry.join(room.code)).toThrow(ClassroomCapacityError);
    expect(Object.keys(registry.getBySession("session.1"))).toEqual(["code", "participantCount", "capacity"]);
    expect(() => registry.authenticate(room.code, "wrong-token")).toThrow(ClassroomAccessError);
  });
});
