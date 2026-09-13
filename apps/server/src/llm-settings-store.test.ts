import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LlmSettingsStore } from "./llm-settings-store.ts";

describe("LlmSettingsStore", () => {
  it("returns only connection status and keeps a submitted key when later left blank", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aituber-llm-")), "settings.json");
    const store = new LlmSettingsStore(path, {});
    expect(store.get()).toEqual({ apiKeyConfigured: false, model: "", baseUrl: "" });
    expect(store.save({ apiKey: "secret-value", model: "model-a" })).toEqual({ apiKeyConfigured: true, model: "model-a", baseUrl: "" });
    expect(store.save({ model: "model-b" })).toEqual({ apiKeyConfigured: true, model: "model-b", baseUrl: "" });
    expect(readFileSync(path, "utf8")).toContain("secret-value");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("allows keyless Ollama and rejects a keyless external URL", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aituber-llm-")), "settings.json");
    const store = new LlmSettingsStore(path, {});
    expect(store.save({ model: "qwen3:8b", baseUrl: "http://localhost:11434/v1" }).apiKeyConfigured).toBe(false);
    expect(() => store.save({ model: "remote", baseUrl: "https://example.com/v1" })).toThrow(/API key/);
  });
});
