import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { DataRetentionStore, RetentionPurgeResult } from "@aituber/storage";

export const DEFAULT_RAW_DATA_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const CACHE_FILE = /^[a-f0-9]{64}\.(?:audio|json)$/;

export class DataRetentionService {
  readonly #store: DataRetentionStore; readonly #cacheDirectories: readonly string[]; readonly #retentionMs: number; readonly #now: () => Date;
  #timer: ReturnType<typeof setInterval> | null = null;
  constructor(options: { readonly store: DataRetentionStore; readonly cacheDirectories?: readonly string[]; readonly retentionMs?: number; readonly now?: () => Date }) {
    this.#store = options.store; this.#cacheDirectories = options.cacheDirectories ?? []; this.#retentionMs = options.retentionMs ?? DEFAULT_RAW_DATA_RETENTION_MS; this.#now = options.now ?? (() => new Date());
    if (!Number.isSafeInteger(this.#retentionMs) || this.#retentionMs < 60_000) throw new TypeError("retentionMs must be at least one minute");
  }
  async purgeNow(): Promise<{ readonly data: RetentionPurgeResult; readonly cacheFiles: number }> {
    const cutoff = new Date(this.#now().getTime() - this.#retentionMs); const data = this.#store.purgeBefore(cutoff.toISOString());
    const cacheFiles = (await Promise.all(this.#cacheDirectories.map((directory) => purgeCacheDirectory(directory, cutoff)))).reduce((sum, count) => sum + count, 0);
    return { data, cacheFiles };
  }
  start(intervalMs = 60 * 60 * 1_000) { if (this.#timer) return; this.#timer = setInterval(() => { void this.purgeNow().catch(() => undefined); }, intervalMs); this.#timer.unref(); }
  close() { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }
}

export async function purgeCacheDirectory(directory: string, cutoff: Date): Promise<number> {
  let names: string[];
  try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
  let deleted = 0;
  for (const name of names) {
    if (!CACHE_FILE.test(name)) continue;
    const path = join(directory, name); const metadata = await stat(path);
    if (!metadata.isFile() || metadata.mtimeMs > cutoff.getTime()) continue;
    await unlink(path); deleted += 1;
  }
  return deleted;
}
