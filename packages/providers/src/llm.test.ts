import { describe, expect, it, vi } from "vitest";
import { FixedResponseLlmProvider, LlmProviderError, OpenAiCompatibleLlmProvider, openAiCompatibleOptionsFromEnv } from "./llm.ts";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "reasons"],
  properties: {
    decision: { enum: ["accept", "reject"] },
    reasons: { type: "array", maxItems: 3, items: { type: "string", maxLength: 100 } },
  },
} as const;

describe("OpenAiCompatibleLlmProvider", () => {
  it("loads one simple connection from environment settings", () => {
    expect(openAiCompatibleOptionsFromEnv({})).toBeNull();
    expect(openAiCompatibleOptionsFromEnv({ AITUBER_LLM_API_KEY: " key ", AITUBER_LLM_MODEL: " model ", AITUBER_LLM_BASE_URL: " https://example.com/v1 ", AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS: "2" })).toMatchObject({ apiKey: "key", model: "model", baseUrl: "https://example.com/v1", inputUsdPerMillionTokens: 2 });
    expect(() => openAiCompatibleOptionsFromEnv({ AITUBER_LLM_API_KEY: "key" })).toThrow(/MODEL/);
  });
  it("sends one isolated context per call and returns validated usage and cost", async () => {
    const requests: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ model: "model.test", choices: [{ message: { content: JSON.stringify({ decision: "accept", reasons: ["valid"] }) } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
    });
    const provider = new OpenAiCompatibleLlmProvider({ apiKey: "secret-test-key", model: "model.test", fetch, inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10 });
    const generation = provider.createContext({ purpose: "generation", systemInstruction: "Generate a lesson." });
    const review = provider.createContext({ purpose: "review", systemInstruction: "Review independently." });

    const result = await generation.generate<{ decision: string; reasons: string[] }>({ prompt: "first", schemaName: "review_result", schema });
    await review.generate({ prompt: "second", schemaName: "review_result", schema });

    expect(result.value).toEqual({ decision: "accept", reasons: ["valid"] });
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120, estimatedCostUsd: 0.0004 });
    expect(requests[0]?.messages).toEqual([{ role: "system", content: "Generate a lesson." }, { role: "user", content: "first" }]);
    expect(requests[1]?.messages).toEqual([{ role: "system", content: "Review independently." }, { role: "user", content: "second" }]);
    expect(requests[1]?.messages).not.toContainEqual({ role: "user", content: "first" });
    expect(requests[0]?.response_format).toEqual({ type: "json_schema", json_schema: { name: "review_result", strict: true, schema } });
  });

  it("accepts a keyless loopback Ollama endpoint", () => {
    expect(() => new OpenAiCompatibleLlmProvider({ model: "qwen3:8b", baseUrl: "http://localhost:11434/v1" })).not.toThrow();
    expect(() => new OpenAiCompatibleLlmProvider({ model: "remote", baseUrl: "https://example.com/v1" })).toThrow(/API key/);
    expect(() => new OpenAiCompatibleLlmProvider({ apiKey: "key", model: "remote", baseUrl: "https://secret@example.com/v1" })).toThrow(/credentials/);
  });

  it("disables hidden reasoning for bounded Ollama structured output", async () => {
    let body: Record<string, unknown> = {};
    const provider = new OpenAiCompatibleLlmProvider({ model: "qwen3:8b", baseUrl: "http://localhost:11434/v1", fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ decision: "accept", reasons: [] }) } }] });
    } });
    await provider.createContext({ purpose: "review", systemInstruction: "Review." }).generate({ prompt: "value", schemaName: "review", schema, maxOutputTokens: 128 });
    expect(body.reasoning_effort).toBe("none");
  });

  it("avoids Ollama grammar expansion while enforcing the original length limit", async () => {
    let body = "";
    const provider = new OpenAiCompatibleLlmProvider({ model:"qwen3:8b",baseUrl:"http://localhost:11434/v1",fetch:async (_input,init)=>{
      body=String(init?.body); return Response.json({choices:[{message:{content:JSON.stringify({text:"too long"})}}]});
    }});
    await expect(provider.createContext({purpose:"review",systemInstruction:"Review"}).generate({prompt:"value",schemaName:"bounded",schema:{type:"object",properties:{text:{type:"string",maxLength:3}},required:["text"],additionalProperties:false}})).rejects.toMatchObject({code:"schema_mismatch"});
    expect(body).not.toContain("maxLength");
  });

  it("retries one transient provider failure inside the same timeout boundary", async () => {
    let calls = 0;
    const provider = new OpenAiCompatibleLlmProvider({ apiKey: "key", model: "model", fetch: async () => {
      calls += 1;
      return calls === 1 ? new Response("busy", { status: 503 }) : Response.json({ choices: [{ message: { content: JSON.stringify({ decision: "accept", reasons: [] }) } }] });
    } });
    const result = await provider.createContext({ purpose: "generation", systemInstruction: "Generate." }).generate({ prompt: "value", schemaName: "review", schema });
    expect(result.value).toEqual({ decision: "accept", reasons: [] });
    expect(calls).toBe(2);
  });

  it("rejects malformed, oversized, and schema-invalid responses", async () => {
    const cases = [
      { body: "not json", expected: "invalid_response" },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: "accept", reasons: [], extra: true }) } }] }), expected: "schema_mismatch" },
      { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: "accept", reasons: [] }) } }] }), expected: "response_too_large", maxOutputBytes: 4 },
    ];
    for (const item of cases) {
      const provider = new OpenAiCompatibleLlmProvider({ apiKey: "key", model: "model", fetch: async () => new Response(item.body) });
      const promise = provider.createContext({ purpose: "review", systemInstruction: "Review." }).generate({ prompt: "value", schemaName: "review", schema, ...(item.maxOutputBytes ? { maxOutputBytes: item.maxOutputBytes } : {}) });
      await expect(promise).rejects.toMatchObject({ code: item.expected });
    }
  });

  it("rejects unsafe generation bounds before calling the endpoint", async () => {
    const fetch = vi.fn(); const provider = new OpenAiCompatibleLlmProvider({ apiKey: "key", model: "model", fetch });
    await expect(provider.createContext({ purpose: "review", systemInstruction: "Review." }).generate({ prompt: "value", schemaName: "review", schema, maxOutputTokens: -1 })).rejects.toThrow(/maxOutputTokens/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("distinguishes caller cancellation from timeout without including the API key", async () => {
    const pendingFetch = (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    const timeoutProvider = new OpenAiCompatibleLlmProvider({ apiKey: "never-log-this", model: "model", timeoutMs: 5, fetch: pendingFetch });
    const timeout = timeoutProvider.createContext({ purpose: "generation", systemInstruction: "Generate." }).generate({ prompt: "value", schemaName: "value", schema });
    await expect(timeout).rejects.toMatchObject({ code: "timeout" });
    await expect(timeout).rejects.not.toThrow(/never-log-this/);

    const controller = new AbortController();
    const cancelled = new OpenAiCompatibleLlmProvider({ apiKey: "key", model: "model", fetch: pendingFetch }).createContext({ purpose: "generation", systemInstruction: "Generate." }).generate({ prompt: "value", schemaName: "value", schema, signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("FixedResponseLlmProvider", () => {
  it("provides deterministic schema-validated responses for generation and review", async () => {
    const provider = new FixedResponseLlmProvider([{ decision: "accept", reasons: [] }, { decision: "reject", reasons: ["unsupported"] }]);
    const generated = await provider.createContext({ purpose: "generation", systemInstruction: "Generate." }).generate({ prompt: "lesson", schemaName: "review", schema });
    const reviewed = await provider.createContext({ purpose: "review", systemInstruction: "Review." }).generate({ prompt: "candidate", schemaName: "review", schema });
    expect(generated.value).toEqual({ decision: "accept", reasons: [] });
    expect(reviewed.value).toEqual({ decision: "reject", reasons: ["unsupported"] });
    expect(provider.calls.map((call) => call.purpose)).toEqual(["generation", "review"]);
  });

  it("uses the same bounded schema failure as the network provider", async () => {
    const provider = new FixedResponseLlmProvider([{ decision: "accept", reasons: new Array(4).fill("too many") }]);
    try {
      await provider.createContext({ purpose: "review", systemInstruction: "Review." }).generate({ prompt: "candidate", schemaName: "review", schema });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmProviderError);
      expect(error).toMatchObject({ code: "schema_mismatch" });
      expect((error as LlmProviderError).options.schemaIssues?.length).toBeLessThanOrEqual(20);
    }
  });
});
