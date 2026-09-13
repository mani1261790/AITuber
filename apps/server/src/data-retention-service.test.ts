import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { purgeCacheDirectory } from "./data-retention-service.ts";

describe("purgeCacheDirectory", () => {
  it("removes only expired bounded speech-cache files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aituber-cache-retention-")); await mkdir(directory, { recursive: true });
    const old = `${"a".repeat(64)}.audio`; const fresh = `${"b".repeat(64)}.json`; const unrelated = "keep.txt";
    await Promise.all([writeFile(join(directory, old), "old"), writeFile(join(directory, fresh), "fresh"), writeFile(join(directory, unrelated), "keep")]);
    await utimes(join(directory, old), new Date("2026-09-01"), new Date("2026-09-01"));
    await utimes(join(directory, fresh), new Date("2026-09-10"), new Date("2026-09-10"));
    expect(await purgeCacheDirectory(directory, new Date("2026-09-07"))).toBe(1);
    await expect(readFile(join(directory, old))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(directory, fresh), "utf8")).toBe("fresh"); expect(await readFile(join(directory, unrelated), "utf8")).toBe("keep");
  });
});
