import { access } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
await Promise.all(["apps/server/dist/index.js", "apps/classroom/dist/index.html", "apps/operator/dist/index.html"].map(async (path) => {
  try { await access(resolve(root, path)); } catch { throw new Error(`Missing ${path}. Run pnpm build before pnpm start.`); }
}));

const children: ChildProcess[] = [];
let stopping = false;
process.on("SIGINT", () => shutdown(0)); process.on("SIGTERM", () => shutdown(0));
const launch = (arguments_: readonly string[]) => {
  const child = spawn(process.execPath, arguments_, { cwd: root, env: process.env, stdio: "inherit" }); children.push(child);
  child.on("exit", (code, signal) => { if (!stopping) { process.stderr.write(`AITuber process exited (${signal ?? code ?? "unknown"})\n`); shutdown(code ?? 1); } });
  return child;
};

launch([resolve(root, "apps/server/dist/index.js")]);
await waitForApi();
launch(["--experimental-strip-types", resolve(root, "scripts/serve-built-surface.ts"), "classroom"]);
launch(["--experimental-strip-types", resolve(root, "scripts/serve-built-surface.ts"), "operator"]);

async function waitForApi() {
  const port = Number.parseInt(process.env.AITUBER_PORT ?? "4310", 10); const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/healthz`); if (response.ok) return; } catch { /* Startup is still in progress. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  shutdown(1); throw new Error("AITuber API did not become ready within 10 seconds");
}

function shutdown(code: number) {
  if (stopping) return; stopping = true;
  children.forEach((child) => { if (running(child)) child.kill("SIGTERM"); });
  setTimeout(() => { children.forEach((child) => { if (running(child)) child.kill("SIGKILL"); }); process.exit(code); }, 2_000).unref();
  Promise.all(children.map((child) => new Promise<void>((resolve) => child.once("exit", () => resolve())))).finally(() => process.exit(code));
}

function running(child: ChildProcess) { return child.exitCode === null && child.signalCode === null; }
