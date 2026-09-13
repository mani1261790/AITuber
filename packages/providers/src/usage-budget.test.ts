import { describe, expect, it } from "vitest";
import { FixedResponseLlmProvider } from "./llm.ts";
import { TestToneSpeechProvider } from "./speech.ts";
import { BudgetedLlmProvider, BudgetedSpeechProvider, type UsageBudget } from "./usage-budget.ts";

describe("budgeted providers", () => {
  it("does not reserve or call LLM/TTS while only configured and waiting", () => {
    let reservations = 0; const budget: UsageBudget = { reserve: () => { reservations += 1; return { id: "idle", commit: () => undefined }; } };
    const llm = new BudgetedLlmProvider({ backing: new FixedResponseLlmProvider([{ ok: true }]), budget, scope: "runtime", inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 });
    llm.createContext({ purpose: "live-supplement", systemInstruction: "Wait." });
    new BudgetedSpeechProvider({ backing: new TestToneSpeechProvider(), budget, scope: "runtime", usdPerMillionCharacters: 0 });
    expect(reservations).toBe(0);
  });

  it("reserves the retry-inclusive LLM maximum before entering the provider", async () => {
    const events: string[] = []; const reservations: Parameters<UsageBudget["reserve"]>[0][] = [];
    const budget: UsageBudget = { reserve: (input) => { events.push("reserve"); reservations.push(input); return { id: "r1", commit: () => events.push("commit") }; } };
    const backing = new FixedResponseLlmProvider([{ ok: true }]);
    const provider = new BudgetedLlmProvider({ backing, budget, scope: "runtime", inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 8 });
    const result = await provider.createContext({ purpose: "post-class-answer", systemInstruction: "System" }).generate({ prompt: "Prompt", schemaName: "answer", schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } }, maxOutputTokens: 100 });
    expect(result.value).toEqual({ ok: true }); expect(events).toEqual(["reserve", "commit"]);
    expect(reservations[0]).toMatchObject({ scope: "runtime", resource: "llm" });
    expect(reservations[0]!.maximumUnits).toBeGreaterThan(200); expect(reservations[0]!.maximumCostUsd).toBeGreaterThan(0);
  });

  it("reserves TTS characters and commits even when synthesis fails", async () => {
    const events: string[] = []; const budget: UsageBudget = { reserve: (input) => ({ id: String(input.maximumUnits), commit: () => events.push("commit") }) };
    const failing = { provider: "fixture", model: "v1", synthesize: async () => { throw new Error("failed"); } };
    const provider = new BudgetedSpeechProvider({ backing: failing, budget, scope: "runtime", usdPerMillionCharacters: 5 });
    await expect(provider.synthesize({ text: "三文字", language: "ja-JP", voiceId: "voice.test", dictionaryVersion: "dict.v1" }, { signal: new AbortController().signal })).rejects.toThrow("failed");
    expect(events).toEqual(["commit"]);
    const free = new BudgetedSpeechProvider({ backing: new TestToneSpeechProvider(), budget, scope: "runtime", usdPerMillionCharacters: 0 });
    await free.synthesize({ text: "無料", language: "ja-JP", voiceId: "voice.test", dictionaryVersion: "dict.v1" }, { signal: new AbortController().signal });
  });
});
