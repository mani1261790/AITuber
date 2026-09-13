import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ClassroomJoinRequest, ClassroomReconnectRequest, ClassroomSnapshot, ClassroomStreamMessage, CreateSessionRequest, FixedSessionView, LlmSettingsView, SessionCommandRequest, UpdateLlmSettingsRequest } from "@aituber/contracts";
import { WebSocketServer } from "ws";
import { ClassroomAccessError, ClassroomCapacityError, ClassroomRegistry } from "./classroom-registry.ts";

export interface SettingsApi { get(): LlmSettingsView; save(request: UpdateLlmSettingsRequest): LlmSettingsView }

export interface LectureApi {
  listCourses(): unknown;
  createSession(request: CreateSessionRequest): FixedSessionView;
  getCurrentSession(): FixedSessionView | null;
  getSession(sessionId: string): FixedSessionView;
  getSnapshot(sessionId: string): ClassroomSnapshot;
  subscribe(listener: (sessionId: string, snapshot: ClassroomSnapshot) => void): () => void;
  getSpeechAudio(sessionId: string, epoch: number, cacheKey: string): { readonly audio: Uint8Array; readonly mimeType: string };
  command(sessionId: string, request: SessionCommandRequest): FixedSessionView;
}

const unavailableApi: LectureApi = {
  listCourses: () => [], createSession: () => { throw new Error("lecture_api_unavailable"); }, getCurrentSession: () => null,
  getSession: () => { throw new RangeError("Unknown session"); }, getSnapshot: () => { throw new RangeError("Unknown session"); },
  subscribe: () => () => undefined, getSpeechAudio: () => { throw new RangeError("Unknown speech artifact"); }, command: () => { throw new RangeError("Unknown session"); },
};

export function createApp(api: LectureApi = unavailableApi, settings?: SettingsApi): Server {
  const classrooms = new ClassroomRegistry();
  const streams = new Map<string, Set<{ send(value: string): void; readyState: number }>>();
  const webSockets = new WebSocketServer({ noServer: true });
  const unsubscribe = api.subscribe((sessionId, snapshot) => {
    const sockets = streams.get(sessionId);
    if (!sockets) return;
    const message: ClassroomStreamMessage = { type: "snapshot", snapshot, room: classrooms.getBySession(sessionId) };
    sockets.forEach((socket) => { if (socket.readyState === 1) socket.send(JSON.stringify(message)); });
  });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/healthz") return json(response, 200, { status: "ok" });
      if (url.pathname === "/api/settings/llm") {
        requireSurface(request, "operator");
        if (!settings) throw new RangeError("LLM settings are unavailable");
        if (request.method === "GET") return json(response, 200, { settings: settings.get() });
        if (request.method === "PUT") return json(response, 200, { settings: settings.save(await readJson<UpdateLlmSettingsRequest>(request)) });
      }
      if (request.method === "POST" && url.pathname === "/api/classrooms/join") {
        requireSurface(request, "classroom");
        const access = classrooms.join((await readJson<ClassroomJoinRequest>(request)).code);
        return json(response, 201, { participant: access.participant, room: access.room, snapshot: api.getSnapshot(access.sessionId) });
      }
      const reconnectMatch = url.pathname.match(/^\/api\/classrooms\/([^/]+)\/reconnect$/);
      if (request.method === "POST" && reconnectMatch) {
        requireSurface(request, "classroom");
        const access = classrooms.authenticate(reconnectMatch[1]!, (await readJson<ClassroomReconnectRequest>(request)).accessToken);
        return json(response, 200, { participant: access.participant, room: access.room, snapshot: api.getSnapshot(access.sessionId) });
      }
      const answerMatch = url.pathname.match(/^\/api\/classrooms\/([^/]+)\/answer$/);
      if (request.method === "POST" && answerMatch) {
        requireSurface(request, "classroom");
        const body = await readJson<{ accessToken: string; answer: string }>(request);
        const access = classrooms.authenticate(answerMatch[1]!, body.accessToken);
        api.command(access.sessionId, { command: "answer", answer: body.answer });
        return json(response, 200, { snapshot: api.getSnapshot(access.sessionId) });
      }
      if (request.method === "GET" && url.pathname === "/api/courses") { requireSurface(request, "operator"); return json(response, 200, { courses: api.listCourses() }); }
      if (request.method === "GET" && url.pathname === "/api/sessions/current") {
        requireSurface(request, "operator"); const session = api.getCurrentSession();
        return json(response, 200, { session, classroom: session ? classrooms.create(session.id) : null });
      }
      const audioMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/speech\/([a-f0-9]{64})$/);
      if (request.method === "GET" && audioMatch) {
        requireAnySurface(request);
        const epoch = Number.parseInt(url.searchParams.get("epoch") ?? "", 10);
        if (!Number.isSafeInteger(epoch) || epoch < 1) throw new TypeError("A valid speech epoch is required");
        const artifact = api.getSpeechAudio(decodeURIComponent(audioMatch[1]!), epoch, audioMatch[2]!);
        response.writeHead(200, { "content-type": artifact.mimeType, "cache-control": "no-store" }); response.end(Buffer.from(artifact.audio)); return;
      }
      requireSurface(request, "operator");
      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      const commandMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/commands$/);
      if (request.method === "GET" && sessionMatch) { const session = api.getSession(decodeURIComponent(sessionMatch[1]!)); return json(response, 200, { session, classroom: classrooms.create(session.id) }); }
      if (request.method === "POST" && url.pathname === "/api/sessions") { const session = api.createSession(await readJson<CreateSessionRequest>(request)); return json(response, 201, { session, classroom: classrooms.create(session.id) }); }
      if (request.method === "POST" && commandMatch) { const session = api.command(decodeURIComponent(commandMatch[1]!), await readJson<SessionCommandRequest>(request)); return json(response, 200, { session, classroom: classrooms.create(session.id) }); }
      return json(response, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof ClassroomCapacityError) return json(response, 409, { error: "classroom_full", message: "この教室は参加上限の5人に達しています。" });
      if (error instanceof ClassroomAccessError) return json(response, 401, { error: "invalid_participant", message: "参加情報が無効です。教室コードから入り直してください。" });
      if (error instanceof RangeError) return json(response, 404, { error: "not_found", message: error.message });
      if (error instanceof SurfaceAccessError) return json(response, 403, { error: "forbidden" });
      if (error instanceof TypeError || error instanceof SyntaxError) return json(response, 400, { error: "invalid_request", message: error.message });
      return json(response, 500, { error: "internal_error" });
    }
  });
  server.on("upgrade", (request, socket, head) => {
    try {
      requireSurface(request, "classroom");
      const url = new URL(request.url ?? "/", "http://localhost"); const match = url.pathname.match(/^\/api\/classrooms\/([^/]+)\/stream$/);
      if (!match) throw new ClassroomAccessError();
      const access = classrooms.authenticate(match[1]!, url.searchParams.get("token") ?? "");
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        const group = streams.get(access.sessionId) ?? new Set(); streams.set(access.sessionId, group); group.add(webSocket);
        webSocket.send(JSON.stringify({ type: "snapshot", snapshot: api.getSnapshot(access.sessionId), room: access.room } satisfies ClassroomStreamMessage));
        webSocket.on("close", () => { group.delete(webSocket); if (group.size === 0) streams.delete(access.sessionId); });
      });
    } catch { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); }
  });
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true; unsubscribe();
    webSockets.clients.forEach((client) => client.terminate());
    webSockets.close();
  };
  server.on("aituber:shutdown", cleanup);
  server.on("close", cleanup);
  return server;
}

class SurfaceAccessError extends Error {}
function surface(request: IncomingMessage): string { return String(request.headers["x-aituber-surface"] ?? ""); }
function requireSurface(request: IncomingMessage, expected: "operator" | "classroom") { if (surface(request) !== expected) throw new SurfaceAccessError(); }
function requireAnySurface(request: IncomingMessage) { if (!new Set(["operator", "classroom"]).has(surface(request))) throw new SurfaceAccessError(); }
async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += buffer.length; if (length > 64 * 1024) throw new TypeError("request body is too large"); chunks.push(buffer); }
  if (chunks.length === 0) throw new TypeError("JSON request body is required"); return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
function json(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(value)); }
