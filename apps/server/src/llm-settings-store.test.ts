import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmSettingsStore } from "./llm-settings-store.ts";
import { ResourceBudgetStore } from "@aituber/storage";

afterEach(() => vi.unstubAllGlobals());

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

  it("keeps environment pricing when UI connection settings are used", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aituber-llm-")), "settings.json");
    const store = new LlmSettingsStore(path, { AITUBER_LLM_MODEL: "initial", AITUBER_LLM_API_KEY: "secret", AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS: "1.5", AITUBER_LLM_OUTPUT_USD_PER_MILLION_TOKENS: "6" });
    store.save({ model: "updated" });
    expect(store.connectionOptions()).toMatchObject({ model: "updated", inputUsdPerMillionTokens: 1.5, outputUsdPerMillionTokens: 6 });
  });

  it("keeps pricing even when the connection itself is configured only in the UI", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aituber-llm-")), "settings.json");
    const store = new LlmSettingsStore(path, { AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS: "1", AITUBER_LLM_OUTPUT_USD_PER_MILLION_TOKENS: "4" });
    store.save({ apiKey: "secret", model: "remote" });
    expect(store.connectionOptions()).toMatchObject({ model: "remote", inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 4 });
  });

  it("blocks an unpriced external call before fetch when production budgeting is enabled", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "aituber-llm-")), "settings.json"); const budget = new ResourceBudgetStore(":memory:", { runtime: 1 });
    const store = new LlmSettingsStore(path, {}, budget); store.save({ apiKey: "secret", model: "remote" }); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(store.createProvider("runtime").createContext({ purpose: "review", systemInstruction: "Review." }).generate({ prompt: "value", schemaName: "value", schema: { type: "object" }, maxOutputTokens: 10 })).rejects.toThrow(/単価/);
    expect(fetch).not.toHaveBeenCalled(); budget.close();
  });
});
