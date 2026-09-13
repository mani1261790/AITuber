import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { CreateSessionRequest, FixedSessionView, SessionCommandRequest } from "@aituber/contracts";

export interface LectureApi {
  listCourses(): unknown;
  createSession(request: CreateSessionRequest): FixedSessionView;
  getCurrentSession(): FixedSessionView | null;
  getSession(sessionId: string): FixedSessionView;
  command(sessionId: string, request: SessionCommandRequest): FixedSessionView;
}

const unavailableApi: LectureApi = {
  listCourses: () => [],
  createSession: () => { throw new Error("lecture_api_unavailable"); },
  getCurrentSession: () => null,
  getSession: () => { throw new RangeError("Unknown session"); },
  command: () => { throw new RangeError("Unknown session"); },
};

export function createApp(api: LectureApi = unavailableApi): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/healthz") return json(response, 200, { status: "ok" });
      if (request.method === "GET" && url.pathname === "/api/courses") return json(response, 200, { courses: api.listCourses() });
      if (request.method === "GET" && url.pathname === "/api/sessions/current") return json(response, 200, { session: api.getCurrentSession() });

      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      const commandMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/commands$/);
      if (request.method === "GET" && sessionMatch) return json(response, 200, { session: api.getSession(decodeURIComponent(sessionMatch[1]!)) });
      if (request.method === "POST" && url.pathname === "/api/sessions") {
        return json(response, 201, { session: api.createSession(await readJson<CreateSessionRequest>(request)) });
      }
      if (request.method === "POST" && commandMatch) {
        return json(response, 200, { session: api.command(decodeURIComponent(commandMatch[1]!), await readJson<SessionCommandRequest>(request)) });
      }
      return json(response, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof RangeError) return json(response, 404, { error: "not_found", message: error.message });
      if (error instanceof TypeError || error instanceof SyntaxError) return json(response, 400, { error: "invalid_request", message: error.message });
      return json(response, 500, { error: "internal_error" });
    }
  });
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 64 * 1024) throw new TypeError("request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new TypeError("JSON request body is required");
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}
