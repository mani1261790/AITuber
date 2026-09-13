import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { LectureEventStore } from "../packages/storage/dist/index.js";

const dataDirectory = resolve(process.env.AITUBER_DATA_DIR ?? ".data");
const databasePath = resolve(process.env.AITUBER_DB_PATH ?? join(dataDirectory, "aituber.db"));
const authoringPath = resolve(process.env.AITUBER_AUTHORING_PATH ?? join(dataDirectory, "authoring"));
const defaultRoot = resolve(process.env.AITUBER_BACKUP_PATH ?? join(dataDirectory, "backups"));
const destination = resolve(process.argv[2] ?? join(defaultRoot, timestamp()));
await access(databasePath).catch(() => { throw new Error(`Database does not exist: ${databasePath}`); });
await ensureEmpty(destination); await mkdir(destination, { recursive: true });

const databaseName = basename(databasePath);
const store = new LectureEventStore(databasePath);
try { await store.backup(join(destination, databaseName)); } finally { store.close(); }
if (await exists(authoringPath)) await cp(authoringPath, join(destination, "authoring"), { recursive: true, force: false, errorOnExist: true });

const files = await fileHashes(destination);
const manifest = { format: "aituber-backup-v1", createdAt: new Date().toISOString(), databaseFile: databaseName, authoringDirectory: files.some((item) => item.path.startsWith("authoring/")) ? "authoring" : null, files };
await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${destination}\n`);

async function ensureEmpty(path: string) { if (!await exists(path)) return; if ((await readdir(path)).length > 0) throw new Error(`Backup destination is not empty: ${path}`); }
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
async function fileHashes(root: string) {
  const result: { path: string; sha256: string; bytes: number }[] = [];
  async function visit(directory: string) { for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) await visit(path); else if (entry.isFile()) { const data = await readFile(path); result.push({ path: relative(root, path), sha256: createHash("sha256").update(data).digest("hex"), bytes: data.byteLength }); } } }
  await visit(root); return result.sort((left, right) => left.path.localeCompare(right.path));
}
function timestamp() { return new Date().toISOString().replaceAll(/[:.]/g, "-"); }
