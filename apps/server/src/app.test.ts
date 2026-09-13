import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { LectureEventStore } from "@aituber/storage";
import { TestToneSpeechProvider } from "@aituber/providers";
import { createApp } from "./app.ts";
import { FixedLectureService } from "./fixed-lecture-service.ts";
import WebSocket from "ws";
import type { AuthoringJobView, CreateAuthoringRequest, LlmSettingsView, ResumeAuthoringRequest } from "@aituber/contracts";

const servers = new Set<ReturnType<typeof createApp>>();
const resources = new Set<{ service: FixedLectureService; store: LectureEventStore }>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  servers.clear();
  for (const resource of resources) {
    resource.service.close();
    resource.store.close();
  }
  resources.clear();
});

async function startServer() {
  const server = createApp();
  servers.add(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("server boundary", () => {
  it("reports health without exposing provider configuration", async () => {
    const origin = await startServer();
    const response = await fetch(`${origin}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns a bounded JSON error for unknown routes", async () => {
    const origin = await startServer();
    const response = await fetch(`${origin}/unknown`, { headers: { "x-aituber-surface": "operator" } });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("keeps LLM settings on the operator-only surface without returning the key", async () => {
    let value: LlmSettingsView = { apiKeyConfigured: false, model: "", baseUrl: "" };
    const server = createApp(undefined, { get: () => value, save: (request) => (value = { apiKeyConfigured: Boolean(request.apiKey), model: request.model, baseUrl: request.baseUrl ?? "" }) });
    servers.add(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${origin}/api/settings/llm`, { headers: { "x-aituber-surface": "classroom" } })).status).toBe(403);
    const saved = await fetch(`${origin}/api/settings/llm`, { method: "PUT", headers: { "content-type": "application/json", "x-aituber-surface": "operator" }, body: JSON.stringify({ apiKey: "secret", model: "model" }) });
    expect(await saved.json()).toEqual({ settings: { apiKeyConfigured: true, model: "model", baseUrl: "" } });
  });

  it("exposes course authoring creation, monitoring, resume, and restart only to the operator", async () => {
    const job = authoringJob(); const calls: string[] = [];
    const authoring = {
      list: () => [job], get: (id: string) => { calls.push(`get:${id}`); return job; },
      begin: async (request: CreateAuthoringRequest) => { calls.push(`begin:${request.durationMinutes}:${request.sources.length}`); return job; },
      beginResume: (id: string, request?: ResumeAuthoringRequest) => { calls.push(`resume:${id}:${request?.additionalTimeBudgetMs ?? "default"}`); return job; },
      beginRestart: (id: string) => { calls.push(`restart:${id}`); return job; },
    };
    const server = createApp(undefined, undefined, authoring);
    servers.add(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; const operator = { "x-aituber-surface": "operator" };

    expect((await fetch(`${origin}/api/authoring/jobs`, { headers: { "x-aituber-surface": "classroom" } })).status).toBe(403);
    expect((await fetch(`${origin}/api/authoring/jobs`, { headers: operator })).status).toBe(200);
    const created = await fetch(`${origin}/api/authoring/jobs`, { method: "POST", headers: { ...operator, "content-type": "application/json" }, body: JSON.stringify({ durationMinutes: 15, sources: [{ fileName: "note.md", mimeType: "text/markdown", dataBase64: "YQ==", rights: { basis: "owned" } }] }) });
    expect(created.status).toBe(202);
    expect((await fetch(`${origin}/api/authoring/jobs/${job.id}`, { headers: operator })).status).toBe(200);
    expect((await fetch(`${origin}/api/authoring/jobs/${job.id}/resume`, { method: "POST", headers: operator })).status).toBe(202);
    expect((await fetch(`${origin}/api/authoring/jobs/${job.id}/restart`, { method: "POST", headers: operator })).status).toBe(202);
    expect(calls).toEqual(["begin:15:1", `get:${job.id}`, `resume:${job.id}:default`, `restart:${job.id}`]);
  });

  it("starts and controls a fixed lecture through JSON endpoints", async () => {
    const store = new LectureEventStore(":memory:");
    const service = new FixedLectureService({ store, playbackUnitMs: 10_000, speechProvider: new TestToneSpeechProvider(1_000), voiceId: "voice.test-tone" });
    resources.add({ service, store });
    const server = createApp(service);
    servers.add(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;

    expect((await fetch(`${origin}/api/courses`)).status).toBe(403);
    const operatorHeaders = { "x-aituber-surface": "operator" };
    const courses = await fetch(`${origin}/api/courses`, { headers: operatorHeaders });
    const courseResult = await courses.json() as { courses: { id: string; durationMinutes: number }[] };
    expect(courseResult.courses).toHaveLength(3);
    const course = courseResult.courses[0]!;

    const started = await fetch(`${origin}/api/sessions`, {
      method: "POST", headers: { "content-type": "application/json", ...operatorHeaders },
      body: JSON.stringify({ coursePackageId: course.id, durationMinutes: course.durationMinutes }),
    });
    expect(started.status).toBe(201);
    const startedResult = await started.json() as { session: { id: string; status: string }; classroom: { code: string } };

    await new Promise<void>((resolve) => setImmediate(resolve));
    const live = await fetch(`${origin}/api/sessions/${startedResult.session.id}`, { headers: operatorHeaders });
    const liveResult = await live.json() as { session: { speech: { audioUrl: string | null } } };
    expect(liveResult.session.speech.audioUrl).toMatch(/^\/api\/sessions\/session\.[^/]+\/speech\/[a-f0-9]{64}\?epoch=1$/);
    const audio = await fetch(`${origin}${liveResult.session.speech.audioUrl}`, { headers: { "x-aituber-surface": "classroom" } });
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect(audio.headers.get("cache-control")).toBe("no-store");
    expect((await audio.arrayBuffer()).byteLength).toBeGreaterThan(44);

    const paused = await fetch(`${origin}/api/sessions/${startedResult.session.id}/commands`, {
      method: "POST", headers: { "content-type": "application/json", ...operatorHeaders }, body: JSON.stringify({ command: "pause" }),
    });
    expect((await paused.json() as { session: { status: string } }).session.status).toBe("PAUSED");
    expect((await fetch(`${origin}${liveResult.session.speech.audioUrl}`, { headers: operatorHeaders })).status).toBe(404);

    const joined = await fetch(`${origin}/api/classrooms/join`, { method: "POST", headers: { "content-type": "application/json", "x-aituber-surface": "classroom" }, body: JSON.stringify({ code: startedResult.classroom.code }) });
    expect(joined.status).toBe(201);
    const joinResult = await joined.json() as { participant: { id: string; accessToken: string }; snapshot: { seq: number; session: { id: string } } };
    expect(joinResult.snapshot.session.id).toBe(startedResult.session.id);
    expect((await fetch(`${origin}/api/sessions/${startedResult.session.id}`, { headers: { "x-aituber-surface": "classroom" } })).status).toBe(403);
    const reconnected = await fetch(`${origin}/api/classrooms/${startedResult.classroom.code}/reconnect`, {
      method: "POST", headers: { "content-type": "application/json", "x-aituber-surface": "classroom" }, body: JSON.stringify({ accessToken: joinResult.participant.accessToken }),
    });
    expect((await reconnected.json() as { participant: { id: string } }).participant.id).toBe(joinResult.participant.id);
    const webSocket = new WebSocket(`${origin.replace("http", "ws")}/api/classrooms/${startedResult.classroom.code}/stream?token=${joinResult.participant.accessToken}&afterSeq=${joinResult.snapshot.seq}`, { headers: { "x-aituber-surface": "classroom" } });
    const [message] = await once(webSocket, "message") as [Buffer];
    expect(JSON.parse(message.toString()).snapshot.seq).toBeGreaterThanOrEqual(joinResult.snapshot.seq);
    webSocket.close();
  });
});

function authoringJob(): AuthoringJobView {
  const now = new Date(0).toISOString();
  return { id: "authoring.123e4567-e89b-12d3-a456-426614174000", status: "running", createdAt: now, updatedAt: now, request: { durationMinutes: 15, timeBudgetMs: 300_000, costBudgetUsd: 2 }, review: null, attempts: 0, elapsedMs: 0, estimatedCostUsd: 0, error: null, sourceCount: 1, course: null };
}
