import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const accountId = "2ea670c2a6ff28e248ef084adf095e8b";
const profile = "aituber-personal";
const checkOnly = process.argv.slice(2).join(" ") === "--check";
if (process.argv.length > 2 && !checkOnly) {
  console.error("Usage: node scripts/deploy-cloudflare.mjs [--check]");
  process.exit(1);
}
function run(args, env) {
  const result = spawnSync("pnpm", args, { cwd: root, env, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error("Cloudflare deployment command failed.");
}
try {
  const config = JSON.parse(await readFile(new URL("../apps/cloudflare/wrangler.jsonc", import.meta.url), "utf8"));
  if (config.account_id !== accountId || config.name !== "aituber") {
    throw new Error("Deployment stopped: AITuber account_id or Worker name does not match the approved target.");
  }
  let token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    const result = spawnSync("pnpm", ["exec", "wrangler", "auth", "token", "--profile", profile, "--json"], {
      cwd: root, encoding: "utf8", timeout: 30_000, env: { ...process.env, CI: "true" },
    });
    // Never forward credential command output: stdout may contain a secret.
    if (result.error || result.status !== 0) throw new Error("AITuber credentials are missing. Authenticate the aituber-personal profile or set CLOUDFLARE_API_TOKEN securely.");
    try { token = JSON.parse(result.stdout).token; } catch { /* Reject unexpected output without logging it. */ }
  }
  if (!token) throw new Error("AITuber token is unavailable; default-account fallback is disabled.");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true || body.result?.id !== accountId) {
    throw new Error(`Deployment stopped: target account access was not verified (HTTP ${response.status}).`);
  }
  console.log(`Verified AITuber account: ${accountId}`);
  if (!checkOnly) {
    // Deploy with the exact verified credential, independent of global login state.
    const env = { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId, CI: "true" };
    for (const name of ["CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL", "CF_API_KEY", "CF_EMAIL", "CF_API_TOKEN", "CF_ACCOUNT_ID"]) delete env[name];
    const secrets = {};
    for (const name of ["OPERATOR_PASSWORD", "FISH_API_KEY", "FISH_VOICE_ID"]) {
      if (!process.env[name]) throw new Error(`Missing deployment secret: ${name}`);
      secrets[name] = process.env[name];
    }
    const bucketUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const bucket = await fetch(`${bucketUrl}/aituber-state`, { headers, signal: AbortSignal.timeout(20_000) });
    if (bucket.status === 404) {
      const created = await fetch(bucketUrl, { method: "POST", headers, body: JSON.stringify({ name: "aituber-state" }), signal: AbortSignal.timeout(20_000) });
      if (!created.ok || (await created.json()).success !== true) throw new Error(`R2 creation failed (HTTP ${created.status}).`);
    } else if (!bucket.ok || (await bucket.json()).success !== true) {
      throw new Error(`R2 access failed (HTTP ${bucket.status}).`);
    }
    run(["build:cloudflare"], env);
    const directory = await mkdtemp(join(tmpdir(), "aituber-deploy-"));
    try {
      const file = join(directory, "secrets.json");
      await writeFile(file, JSON.stringify(secrets), { mode: 0o600 });
      run(["exec", "wrangler", "deploy", "--config", "apps/cloudflare/wrangler.jsonc", "--secrets-file", file], env);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Cloudflare preflight failed.");
  process.exitCode = 1;
}
