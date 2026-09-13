import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { LectureEventStore } from "@aituber/storage";
import { createApp } from "./app.ts";
import { FixedLectureService } from "./fixed-lecture-service.ts";

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
    const response = await fetch(`${origin}/unknown`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("starts and controls a fixed lecture through JSON endpoints", async () => {
    const store = new LectureEventStore(":memory:");
    const service = new FixedLectureService({ store, playbackUnitMs: 10_000 });
    resources.add({ service, store });
    const server = createApp(service);
    servers.add(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;

    const courses = await fetch(`${origin}/api/courses`);
    const courseResult = await courses.json() as { courses: { id: string; durationMinutes: number }[] };
    expect(courseResult.courses).toHaveLength(3);
    const course = courseResult.courses[0]!;

    const started = await fetch(`${origin}/api/sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ coursePackageId: course.id, durationMinutes: course.durationMinutes }),
    });
    expect(started.status).toBe(201);
    const startedResult = await started.json() as { session: { id: string; status: string } };

    const paused = await fetch(`${origin}/api/sessions/${startedResult.session.id}/commands`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "pause" }),
    });
    expect((await paused.json() as { session: { status: string } }).session.status).toBe("PAUSED");
  });
});
