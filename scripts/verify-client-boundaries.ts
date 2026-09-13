import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const sentinel = "aituber-secret-client-leak-probe-7f29c58a";
const build = spawnSync("pnpm", ["--filter", "@aituber/classroom", "--filter", "@aituber/operator", "build"], {
  cwd: root,
  env: { ...process.env, AITUBER_LLM_API_KEY: sentinel, AITUBER_FISH_AUDIO_API_KEY: sentinel },
  encoding: "utf8",
});
if (build.status !== 0) throw new Error(`client boundary build failed: ${build.stderr || build.stdout}`);

const secretValues = [sentinel, process.env.AITUBER_LLM_API_KEY, process.env.AITUBER_FISH_AUDIO_API_KEY].filter((value): value is string => Boolean(value && value.length >= 8));
for (const directory of [resolve(root, "apps/classroom/dist"), resolve(root, "apps/operator/dist")]) {
  for (const path of files(directory)) {
    const contents = readFileSync(path, "utf8");
    if (secretValues.some((secret) => contents.includes(secret))) throw new Error(`browser build contains a server API key: ${path}`);
  }
}

const dependencyText = `${readFileSync(resolve(root, "package.json"), "utf8")}\n${readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8")}`.toLowerCase();
for (const analytics of ["@sentry/", "posthog-js", "@segment/analytics", "mixpanel-browser", "@amplitude/analytics"]) {
  if (dependencyText.includes(analytics)) throw new Error(`external analytics dependency is prohibited: ${analytics}`);
}
process.stdout.write("Browser API-key isolation and no-external-analytics dependency checks passed.\n");

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => { const path = resolve(directory, name); return statSync(path).isDirectory() ? files(path) : [path]; });
}
