import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const mode = process.argv[2];
if (!["check", "deploy"].includes(mode) || process.argv.length !== 3) {
  console.error("Usage: node scripts/cloudflare-remote.mjs check|deploy");
  process.exit(1);
}
const repo = "mani1261790/AITuber";
const workflow = mode === "check" ? "check-cloudflare-account.yml" : "deploy-cloudflare.yml";
const id = randomUUID();
const title = mode === "check" ? `AITuber account check ${id}` : `AITuber deploy ${id}`;
function gh(args, inherited = false) {
  const result = spawnSync("gh", args, { encoding: "utf8", stdio: inherited ? "inherit" : "pipe" });
  if (result.error || result.status !== 0) throw new Error("GitHub CLI command failed. Check GitHub authentication; no Cloudflare default login was used.");
  return result.stdout;
}
try {
  gh(["workflow", "run", workflow, "--repo", repo, "--ref", "main", "-f", `request_id=${id}`]);
  let run;
  for (let attempt = 0; attempt < 20; attempt++) {
    const runs = JSON.parse(gh(["run", "list", "--repo", repo, "--workflow", workflow, "--limit", "20", "--json", "databaseId,displayTitle,url"]));
    run = runs.find(candidate => candidate.displayTitle === title);
    if (run) break;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  if (!run) throw new Error("Workflow dispatched but its run is not yet visible. Check GitHub Actions; do not assume success.");
  console.log(run.url);
  gh(["run", "watch", String(run.databaseId), "--repo", repo, "--exit-status", "--interval", "10"], true);
  const result = JSON.parse(gh(["run", "view", String(run.databaseId), "--repo", repo, "--json", "conclusion"]));
  if (result.conclusion !== "success") throw new Error(`Workflow finished with ${result.conclusion}.`);
  console.log(mode === "check" ? "Connected to the approved account 2ea670c2a6ff28e248ef084adf095e8b through GitHub Actions. This does not check paid-plan availability." : "Deployment workflow succeeded. Verify the live application separately.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Cloudflare remote operation failed.");
  process.exitCode = 1;
}
