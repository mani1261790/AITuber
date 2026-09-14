import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { ClassroomJoinResponse, FixedSessionView } from "@aituber/contracts";

const directory = await mkdtemp(join(tmpdir(), "aituber-self-host-"));
const dataDirectory = join(directory, "data"); const authoringDirectory = join(dataDirectory, "authoring");
await mkdir(authoringDirectory, { recursive: true }); await writeFile(join(authoringDirectory, "fixture.txt"), "self-host acceptance");
const [apiPort, classroomPort, operatorPort] = await uniqueFreePorts(3);
const environment = { ...process.env, AITUBER_PORT: String(apiPort), AITUBER_CLASSROOM_PORT: String(classroomPort), AITUBER_OPERATOR_PORT: String(operatorPort), AITUBER_LAN_HOST: "127.0.0.1", AITUBER_DB_PATH: join(dataDirectory, "aituber.db"), AITUBER_LLM_SETTINGS_PATH: join(dataDirectory, "llm-settings.json"), AITUBER_AUTHORING_PATH: authoringDirectory, AITUBER_TTS_CACHE_PATH: join(dataDirectory, "tts-cache"), AITUBER_TTS_TEST_MODE: "tone", AITUBER_FIXED_PLAYBACK_MS: "100", AITUBER_LLM_API_KEY: "", AITUBER_LLM_MODEL: "", AITUBER_LLM_BASE_URL: "" };
let process_: ChildProcess | null = null;
try {
  process_ = spawn(process.execPath, ["--env-file-if-exists=.env", "--experimental-strip-types", "scripts/start-self-host.ts"], { cwd: resolve("."), env: environment, stdio: ["ignore", "pipe", "pipe"] });
  const output: string[] = []; process_.stdout?.on("data", (chunk) => output.push(String(chunk))); process_.stderr?.on("data", (chunk) => output.push(String(chunk)));
  const operator = `http://127.0.0.1:${operatorPort}`; const classroom = `http://127.0.0.1:${classroomPort}`;
  await waitFor(async () => (await fetch(`${operator}/api/courses`)).ok, 10_000, () => output.join(""));
  const operatorHtml = await (await fetch(operator)).text(); const classroomResponse = await fetch(classroom); const classroomHtml = await classroomResponse.text();
  assert(operatorHtml.includes("/assets/") && classroomHtml.includes("/assets/"), "Built HTML was not served");
  const classroomCsp = classroomResponse.headers.get("content-security-policy") ?? "";
  assert(classroomCsp.includes("connect-src 'self' blob:") && classroomCsp.includes("img-src 'self' data: blob:"), "Classroom CSP did not permit embedded VRM textures");
  const runtimeConfig = await json<{ classroomOrigin: string }>(await fetch(`${operator}/aituber-runtime-config.json`));
  assert(runtimeConfig.classroomOrigin === classroom, "Operator gateway did not expose the runtime classroom origin");
  assert((await fetch(`${classroom}/api/courses`, { headers: { "x-aituber-surface": "operator" } })).status === 403, "Classroom gateway trusted a forged operator surface");
  const courses = await json<{ courses: { id: string }[] }>(await fetch(`${operator}/api/courses`));
  const answers = new Map([["course.quadratic-functions", "(-3, -4)"], ["course.dna-replication", "RNAプライマーが置かれる"], ["course.vae-reparameterization", "epsilon"]]);
  assert(courses.courses.length === 3, "Expected three bundled courses");
  for (const course of courses.courses) await finishCourse(operator, classroom, course.id, answers.get(course.id) ?? "");
  await writeFile(join(dataDirectory, "llm-settings.json"), '{"apiKey":"must-not-enter-backup"}\n');
  await mkdir(join(dataDirectory, "tts-cache"), { recursive: true });
  await writeFile(join(dataDirectory, "tts-cache", "regenerable.opus"), "cache");
  const backupDirectory = join(directory, "backup");
  await runScript("scripts/backup-self-host.ts", [backupDirectory], environment);
  const manifestText = await readFile(join(backupDirectory, "manifest.json"), "utf8");
  assert(!manifestText.includes("llm-settings") && !manifestText.includes("tts-cache") && !manifestText.includes("must-not-enter-backup"), "Backup included secrets or regenerable cache");
  await expectScriptFailure("scripts/restore-self-host.ts", [backupDirectory], environment, "Stop AITuber before restoring");
  await stop(process_); process_ = null;
  const tamperedBackup = join(directory, "tampered-backup");
  await cp(backupDirectory, tamperedBackup, { recursive: true });
  await writeFile(join(tamperedBackup, "unlisted.txt"), "must be rejected");
  await expectScriptFailure("scripts/restore-self-host.ts", [tamperedBackup], environment, "Backup contents do not match manifest");
  const restoredDirectory = join(directory, "restored");
  const restoreEnvironment = { ...environment, AITUBER_DB_PATH: join(restoredDirectory, "aituber.db"), AITUBER_AUTHORING_PATH: join(restoredDirectory, "authoring") };
  await runScript("scripts/restore-self-host.ts", [backupDirectory], restoreEnvironment);
  assert(hash(await readFile(join(backupDirectory, "aituber.db"))) === hash(await readFile(join(restoredDirectory, "aituber.db"))), "Restored database differs from online backup");
  assert((await readFile(join(restoredDirectory, "authoring", "fixture.txt"), "utf8")) === "self-host acceptance", "Authoring data was not restored");
  process.stdout.write(`Self-host acceptance passed: 3 courses, isolated surfaces, backup and restore (${apiPort}/${classroomPort}/${operatorPort})\n`);
} finally { if (process_) await stop(process_); await rm(directory, { recursive: true, force: true }); }

async function finishCourse(operator: string, classroom: string, coursePackageId: string, answer: string) {
  const created = await json<{ session: FixedSessionView; classroom: { code: string } }>(await fetch(`${operator}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coursePackageId, durationMinutes: 6 }) }));
  const joined = await json<ClassroomJoinResponse>(await fetch(`${classroom}/api/classrooms/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: created.classroom.code }) }));
  const reconnected = await json<ClassroomJoinResponse>(await fetch(`${classroom}/api/classrooms/${created.classroom.code}/reconnect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: joined.participant.accessToken }) }));
  assert(reconnected.participant.id === joined.participant.id, `${coursePackageId} did not preserve its participant`);
  await verifyWebSocket(`${classroom.replace("http", "ws")}/api/classrooms/${created.classroom.code}/stream?token=${encodeURIComponent(joined.participant.accessToken)}&afterSeq=0`);
  const checkpoint = await waitFor(async () => { const body = await json<{ session: FixedSessionView }>(await fetch(`${operator}/api/sessions/${created.session.id}`)); return body.session.status === "CHECKPOINT" ? body.session : null; }, 10_000);
  assert(Boolean(checkpoint.assessment), `${coursePackageId} did not reach its checkpoint`);
  await json(await fetch(`${classroom}/api/classrooms/${created.classroom.code}/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: joined.participant.accessToken, answer }) }));
  const finished = await waitFor(async () => { const body = await json<{ session: FixedSessionView }>(await fetch(`${operator}/api/sessions/${created.session.id}`)); return body.session.status === "FINISHED" ? body.session : null; }, 10_000);
  assert(finished.progress.completed === finished.progress.total, `${coursePackageId} did not finish every unit`);
}

async function runScript(script: string, arguments_: readonly string[], env: NodeJS.ProcessEnv) { await new Promise<void>((resolvePromise, reject) => { const child = spawn(process.execPath, ["--experimental-strip-types", script, ...arguments_], { cwd: resolve("."), env, stdio: ["ignore", "pipe", "pipe"] }); let output = ""; child.stdout.on("data", (chunk) => output += String(chunk)); child.stderr.on("data", (chunk) => output += String(chunk)); child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${script} failed (${code}): ${output}`))); }); }
async function expectScriptFailure(script: string, arguments_: readonly string[], env: NodeJS.ProcessEnv, expected: string) { await new Promise<void>((resolvePromise, reject) => { const child = spawn(process.execPath, ["--experimental-strip-types", script, ...arguments_], { cwd: resolve("."), env, stdio: ["ignore", "pipe", "pipe"] }); let output = ""; child.stdout.on("data", (chunk) => output += String(chunk)); child.stderr.on("data", (chunk) => output += String(chunk)); child.on("exit", (code) => code !== 0 && output.includes(expected) ? resolvePromise() : reject(new Error(`${script} did not fail safely: ${output}`))); }); }
async function verifyWebSocket(url: string) { await new Promise<void>((resolvePromise, reject) => { const socket = new WebSocket(url); const timer = setTimeout(() => { socket.close(); reject(new Error("Classroom WebSocket did not deliver an initial snapshot")); }, 3_000); socket.addEventListener("message", () => { clearTimeout(timer); socket.close(); resolvePromise(); }, { once: true }); socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Classroom WebSocket proxy failed")); }, { once: true }); }); }
async function stop(child: ChildProcess) { if (child.exitCode !== null || child.signalCode) return; child.kill("SIGTERM"); await new Promise<void>((resolvePromise) => { const timer = setTimeout(() => { child.kill("SIGKILL"); resolvePromise(); }, 5_000); child.once("exit", () => { clearTimeout(timer); resolvePromise(); }); }); }
async function freePort(): Promise<number> { return await new Promise((resolvePromise, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") { server.close(); reject(new Error("Could not reserve a port")); return; } const port = address.port; server.close((error) => error ? reject(error) : resolvePromise(port)); }); }); }
async function uniqueFreePorts(count: number): Promise<number[]> { const ports = new Set<number>(); while (ports.size < count) ports.add(await freePort()); return [...ports]; }
async function waitFor<T>(read: () => Promise<T | null | false>, timeoutMs: number, details = () => ""): Promise<T> { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { try { const value = await read(); if (value) return value; } catch { /* Endpoint is not ready yet. */ } await new Promise((resolvePromise) => setTimeout(resolvePromise, 50)); } throw new Error(`Timed out after ${timeoutMs}ms. ${details()}`); }
async function json<T = unknown>(response: Response): Promise<T> { const text = await response.text(); if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`); return JSON.parse(text) as T; }
function assert(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
function hash(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
