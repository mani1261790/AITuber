import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

interface BackupManifest { format: "aituber-backup-v1"; databaseFile: string; authoringDirectory: string | null; files: readonly { path: string; sha256: string; bytes: number }[] }

const source = process.argv[2] ? resolve(process.argv[2]) : "";
if (!source) throw new Error("Usage: pnpm restore -- <backup-directory>");
await assertStopped();
const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8")) as BackupManifest;
if (manifest.format !== "aituber-backup-v1" || !safeRelative(manifest.databaseFile) || (manifest.authoringDirectory !== null && !safeRelative(manifest.authoringDirectory))) throw new Error("Unsupported or unsafe backup manifest");
const listedPaths = manifest.files.map((file) => file.path).sort();
const actualPaths = await backupFiles(source);
if (new Set(listedPaths).size !== listedPaths.length || listedPaths.length !== actualPaths.length || listedPaths.some((path, index) => path !== actualPaths[index])) throw new Error("Backup contents do not match manifest");
if (!listedPaths.includes(manifest.databaseFile)) throw new Error("Backup manifest does not include its database");
for (const file of manifest.files) {
  if (!safeRelative(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`Unsafe backup entry: ${file.path}`);
  const data = await readFile(join(source, file.path)); const hash = createHash("sha256").update(data).digest("hex");
  if (data.byteLength !== file.bytes || hash !== file.sha256) throw new Error(`Backup integrity check failed: ${file.path}`);
}

const dataDirectory = resolve(process.env.AITUBER_DATA_DIR ?? ".data");
const databasePath = resolve(process.env.AITUBER_DB_PATH ?? join(dataDirectory, "aituber.db"));
const authoringPath = resolve(process.env.AITUBER_AUTHORING_PATH ?? join(dataDirectory, "authoring"));
const stagingRoot = join(dirname(databasePath), `.restore-${randomUUID()}`);
await mkdir(stagingRoot, { recursive: true });
try {
  const stagedDatabase = join(stagingRoot, basename(databasePath)); await cp(join(source, manifest.databaseFile), stagedDatabase, { force: false, errorOnExist: true });
  const stagedAuthoring = join(stagingRoot, "authoring"); if (manifest.authoringDirectory) await cp(join(source, manifest.authoringDirectory), stagedAuthoring, { recursive: true, force: false, errorOnExist: true });
  const suffix = new Date().toISOString().replaceAll(/[:.]/g, "-");
  await mkdir(dirname(databasePath), { recursive: true });
  if (await exists(databasePath)) await rename(databasePath, `${databasePath}.before-restore-${suffix}`);
  for (const sidecar of [`${databasePath}-wal`, `${databasePath}-shm`]) if (await exists(sidecar)) await rename(sidecar, `${sidecar}.before-restore-${suffix}`);
  await rename(stagedDatabase, databasePath);
  if (manifest.authoringDirectory) { await mkdir(dirname(authoringPath), { recursive: true }); if (await exists(authoringPath)) await rename(authoringPath, `${authoringPath}.before-restore-${suffix}`); await rename(stagedAuthoring, authoringPath); }
} finally { await rm(stagingRoot, { recursive: true, force: true }); }
process.stdout.write(`Restored ${source}\n`);

async function assertStopped() { const port = Number.parseInt(process.env.AITUBER_PORT ?? "4310", 10); try { const response = await fetch(`http://127.0.0.1:${port}/healthz`); if (response.ok) throw new Error("Stop AITuber before restoring a backup"); } catch (error) { if (error instanceof Error && error.message === "Stop AITuber before restoring a backup") throw error; } }
function safeRelative(value: string) { return Boolean(value) && !value.startsWith("/") && !value.split(/[\\/]/).includes("..") && resolve("/safe", value).startsWith(`/safe${sep}`); }
async function exists(path: string) { try { const details = await stat(path); return details.isFile() || details.isDirectory(); } catch { return false; } }
async function backupFiles(root: string) { const files: string[] = []; async function visit(directory: string) { for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) await visit(path); else if (entry.isFile() && path !== join(root, "manifest.json")) files.push(relative(root, path)); else if (!entry.isFile()) throw new Error(`Unsupported backup entry: ${relative(root, path)}`); } } await visit(root); return files.sort(); }
