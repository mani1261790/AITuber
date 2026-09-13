import { randomBytes, randomUUID } from "node:crypto";
import type { ClassroomParticipantAccess, ClassroomRoomView } from "@aituber/contracts";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

interface Room {
  readonly sessionId: string;
  readonly code: string;
  readonly participants: Map<string, ClassroomParticipantAccess>;
}

export class ClassroomRegistry {
  readonly #roomsByCode = new Map<string, Room>();
  readonly #roomsBySession = new Map<string, Room>();
  readonly #capacity: number;

  constructor(capacity = 5) {
    this.#capacity = capacity;
  }

  create(sessionId: string): ClassroomRoomView {
    const existing = this.#roomsBySession.get(sessionId);
    if (existing) return this.view(existing);
    let code = createCode();
    while (this.#roomsByCode.has(code)) code = createCode();
    const room: Room = { sessionId, code, participants: new Map() };
    this.#roomsByCode.set(code, room);
    this.#roomsBySession.set(sessionId, room);
    return this.view(room);
  }

  getBySession(sessionId: string): ClassroomRoomView {
    return this.view(this.#requireBySession(sessionId));
  }

  join(codeInput: string): { participant: ClassroomParticipantAccess; room: ClassroomRoomView; sessionId: string } {
    const room = this.#requireByCode(codeInput);
    if (room.participants.size >= this.#capacity) throw new ClassroomCapacityError();
    const participant = {
      id: `learner.${randomUUID()}`,
      accessToken: randomBytes(32).toString("base64url"),
    };
    room.participants.set(participant.accessToken, participant);
    return { participant, room: this.view(room), sessionId: room.sessionId };
  }

  authenticate(codeInput: string, accessToken: string) {
    const room = this.#requireByCode(codeInput);
    const participant = room.participants.get(accessToken);
    if (!participant) throw new ClassroomAccessError();
    return { participant, room: this.view(room), sessionId: room.sessionId };
  }

  view(room: Room): ClassroomRoomView {
    return { code: room.code, participantCount: room.participants.size, capacity: this.#capacity };
  }

  #requireByCode(codeInput: string): Room {
    const room = this.#roomsByCode.get(normalizeCode(codeInput));
    if (!room) throw new RangeError("Unknown classroom code");
    return room;
  }

  #requireBySession(sessionId: string): Room {
    const room = this.#roomsBySession.get(sessionId);
    if (!room) throw new RangeError("Unknown classroom session");
    return room;
  }
}

export class ClassroomCapacityError extends Error {}
export class ClassroomAccessError extends Error {}

export function normalizeCode(value: string): string {
  return value.trim().replaceAll(/[-\s]/g, "").toUpperCase();
}

function createCode(): string {
  const bytes = randomBytes(6);
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
