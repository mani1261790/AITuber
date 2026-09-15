import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

export type LlmPurpose = "generation" | "review" | "live-supplement" | "live-supplement-review" | "post-class-answer" | "post-class-answer-review";
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface LlmUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly estimatedCostUsd: number | null;
}

export interface LlmResult<T> {
  readonly value: T;
  readonly model: string;
  readonly provider: "openai-compatible" | "fixed";
  readonly usage: LlmUsage;
  readonly latencyMs: number;
}

export interface StructuredGenerationRequest<T> {
  readonly prompt: string;
  readonly images?: readonly { readonly mimeType: "image/png" | "image/jpeg" | "image/webp"; readonly dataBase64: string }[];
  readonly schemaName: string;
  readonly schema: JsonSchema;
  readonly maxOutputTokens?: number;
  readonly maxOutputBytes?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
  readonly validate?: (value: unknown) => value is T;
}

export interface LlmContext {
  readonly purpose: LlmPurpose;
  generate<T>(request: StructuredGenerationRequest<T>): Promise<LlmResult<T>>;
}

export interface LlmProvider {
  createContext(options: { purpose: LlmPurpose; systemInstruction: string }): LlmContext;
}

export interface OpenAiCompatibleLlmOptions {
  readonly apiKey?: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly inputUsdPerMillionTokens?: number;
  readonly outputUsdPerMillionTokens?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export function openAiCompatibleOptionsFromEnv(env: Readonly<Record<string, string | undefined>>): OpenAiCompatibleLlmOptions | null {
  const apiKey = env.AITUBER_LLM_API_KEY?.trim() || undefined;
  const model = env.AITUBER_LLM_MODEL?.trim() ?? "";
  const baseUrl = env.AITUBER_LLM_BASE_URL?.trim() || undefined;
  if (!apiKey && !model && !baseUrl) return null;
  if (!model) throw new TypeError("AITUBER_LLM_MODEL is required when LLM configuration is present");
  const inputPrice = optionalNonNegativeNumber(env.AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS, "AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS");
  const outputPrice = optionalNonNegativeNumber(env.AITUBER_LLM_OUTPUT_USD_PER_MILLION_TOKENS, "AITUBER_LLM_OUTPUT_USD_PER_MILLION_TOKENS");
  return { model, ...(apiKey ? { apiKey } : {}), ...(baseUrl ? { baseUrl } : {}), ...(inputPrice !== undefined ? { inputUsdPerMillionTokens: inputPrice } : {}), ...(outputPrice !== undefined ? { outputUsdPerMillionTokens: outputPrice } : {}) };
}

export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly #options: Required<Pick<OpenAiCompatibleLlmOptions, "model" | "baseUrl" | "timeoutMs" | "maxOutputBytes">> & OpenAiCompatibleLlmOptions;

  constructor(options: OpenAiCompatibleLlmOptions) {
    if (!options.model.trim()) throw new TypeError("LLM model is required");
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://api.openai.com/v1");
    if (!options.apiKey?.trim() && !isLocalBaseUrl(baseUrl)) throw new TypeError("LLM API key is required for non-local endpoints");
    this.#options = { ...options, baseUrl, model: options.model.trim(), timeoutMs: options.timeoutMs ?? 30_000, maxOutputBytes: options.maxOutputBytes ?? 1_000_000 };
  }

  createContext(options: { purpose: LlmPurpose; systemInstruction: string }): LlmContext {
    const systemInstruction = boundedText(options.systemInstruction, 100_000, "systemInstruction");
    return {
      purpose: options.purpose,
      generate: <T>(request: StructuredGenerationRequest<T>) => this.#generate(systemInstruction, request),
    };
  }

  async #generate<T>(systemInstruction: string, request: StructuredGenerationRequest<T>): Promise<LlmResult<T>> {
    validateRequest(request);
    const startedAt = performance.now();
    const { signal, dispose } = withTimeout(request.signal, this.#options.timeoutMs);
    try {
      signal.throwIfAborted();
      const response = await fetchWithRetry(this.#options.fetch ?? globalThis.fetch, `${this.#options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.#options.apiKey ? { authorization: `Bearer ${this.#options.apiKey}` } : {}) },
        body: JSON.stringify({
          model: this.#options.model,
          messages: [{ role: "system", content: systemInstruction }, { role: "user", content: request.images?.length ? [{ type: "text", text: request.prompt }, ...request.images.map((image) => ({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` } }))] : request.prompt }],
          response_format: { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: isOllamaBaseUrl(this.#options.baseUrl) ? ollamaGrammarSchema(request.schema) : request.schema } },
          ...(isOllamaBaseUrl(this.#options.baseUrl) ? { reasoning_effort: "none" } : {}),
          temperature: request.temperature ?? 0,
          max_tokens: request.maxOutputTokens ?? 4_096,
          ...(isOllamaBaseUrl(this.#options.baseUrl) ? { stream: true, stream_options: { include_usage: true } } : { stream: false }),
        }),
        signal,
      }, signal);
      if (!response.ok) throw new LlmProviderError("provider_error", `LLM provider returned HTTP ${response.status}`, { retryable: response.status === 429 || response.status >= 500 });
      const maxBytes = request.maxOutputBytes ?? this.#options.maxOutputBytes;
      let envelope: Envelope;
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        envelope = await readChatStream(response, maxBytes);
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > maxBytes) throw new LlmProviderError("response_too_large", `LLM response exceeded ${maxBytes} bytes`);
        envelope = parseEnvelope(new TextDecoder().decode(bytes));
      }
      const value = parseAndValidate<T>(envelope.content, request.schema, request.validate);
      return { value, model: envelope.model || this.#options.model, provider: "openai-compatible", usage: usage(envelope.usage, this.#options), latencyMs: performance.now() - startedAt };
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      if (signal.aborted) throw new LlmProviderError(request.signal?.aborted ? "cancelled" : "timeout", request.signal?.aborted ? "LLM request was cancelled" : `LLM request timed out after ${this.#options.timeoutMs}ms`);
      throw new LlmProviderError("network_error", error instanceof Error ? error.message : "LLM request failed", { retryable: true });
    } finally { dispose(); }
  }
}

export class FixedResponseLlmProvider implements LlmProvider {
  readonly calls: { readonly purpose: LlmPurpose; readonly systemInstruction: string; readonly prompt: string }[] = [];
  readonly #responses: readonly unknown[];
  readonly #usage: LlmUsage;
  #index = 0;

  constructor(responses: readonly unknown[], usage: LlmUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 }) { this.#responses = structuredClone(responses); this.#usage = usage; }

  createContext(options: { purpose: LlmPurpose; systemInstruction: string }): LlmContext {
    return {
      purpose: options.purpose,
      generate: async <T>(request: StructuredGenerationRequest<T>) => {
        validateRequest(request);
        if (request.signal?.aborted) throw new LlmProviderError("cancelled", "LLM request was cancelled");
        if (this.#index >= this.#responses.length) throw new LlmProviderError("provider_error", "No fixed LLM response remains");
        this.calls.push({ purpose: options.purpose, systemInstruction: options.systemInstruction, prompt: request.prompt });
        const value = parseAndValidate<T>(JSON.stringify(this.#responses[this.#index++]), request.schema, request.validate);
        return { value, model: "fixed-response-v1", provider: "fixed", usage: this.#usage, latencyMs: 0 };
      },
    };
  }
}

export type LlmErrorCode = "cancelled" | "timeout" | "network_error" | "provider_error" | "response_too_large" | "invalid_response" | "schema_mismatch";
export class LlmProviderError extends Error {
  readonly code: LlmErrorCode;
  readonly options: { readonly retryable?: boolean; readonly schemaIssues?: readonly string[] };
  constructor(code: LlmErrorCode, message: string, options: { readonly retryable?: boolean; readonly schemaIssues?: readonly string[] } = {}) { super(message); this.code = code; this.options = options; }
}

interface Envelope { content: string; model: string; usage: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } }
async function readChatStream(response: Response, maxBytes: number): Promise<Envelope> {
  if (!response.body) throw new LlmProviderError("invalid_response", "LLM stream was empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const result: Envelope = { content: "", model: "", usage: {} };
  let pending = "", contentBytes = 0, wireBytes = 0, complete = false;
  const line = (raw: string) => {
    if (!raw.startsWith("data:")) return;
    const data = raw.slice(5).trim();
    if (data === "[DONE]") { complete = true; return; }
    if (!data) return;
    let parsed: unknown;
    try { parsed = JSON.parse(data); } catch { throw new LlmProviderError("invalid_response", "LLM stream contained invalid JSON"); }
    const event = asRecord(parsed);
    if (event.error) throw new LlmProviderError("provider_error", "LLM stream returned an error");
    const choices = Array.isArray(event.choices) ? event.choices : [];
    const choice = asRecord(choices[0]);
    const content = asRecord(choice.delta).content;
    if (typeof content === "string") {
      contentBytes += new TextEncoder().encode(content).byteLength;
      if (contentBytes > maxBytes) throw new LlmProviderError("response_too_large", `LLM response exceeded ${maxBytes} bytes`);
      result.content += content;
    }
    if (typeof event.model === "string") result.model = event.model;
    if (event.usage) result.usage = asRecord(event.usage);
  };
  try {
    while (!complete) {
      const chunk = await reader.read();
      if (chunk.done) { pending += decoder.decode(); break; }
      wireBytes += chunk.value.byteLength;
      if (wireBytes > maxBytes * 256 + 65536) throw new LlmProviderError("response_too_large", "LLM stream exceeded its transport limit");
      pending += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        line(pending.slice(0,end).replace(/\r$/, "")); pending = pending.slice(end+1);
        if (complete) break;
      }
      if (pending.length > Math.max(maxBytes,65536)) throw new LlmProviderError("response_too_large", "LLM stream event was too large");
    }
    if (!complete && pending.trim()) line(pending);
    if (!complete) throw new LlmProviderError("invalid_response", "LLM stream ended before completion");
    return result;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

function parseEnvelope(text: string): Envelope {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new LlmProviderError("invalid_response", "LLM provider returned invalid JSON"); }
  const record = asRecord(value);
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choice = asRecord(choices[0]); const message = asRecord(choice.message);
  if (typeof message.content !== "string") throw new LlmProviderError("invalid_response", "LLM response did not contain message content");
  return { content: message.content, model: typeof record.model === "string" ? record.model : "", usage: asRecord(record.usage) };
}

function parseAndValidate<T>(content: string, schema: JsonSchema, custom?: (value: unknown) => value is T): T {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new LlmProviderError("invalid_response", "LLM message content was not valid JSON"); }
  const validate = compileSchema(schema);
  if (!validate(value)) throw new LlmProviderError("schema_mismatch", "LLM output did not match the required schema", { schemaIssues: schemaIssues(validate.errors) });
  if (custom && !custom(value)) throw new LlmProviderError("schema_mismatch", "LLM output failed domain validation");
  return value as T;
}

function compileSchema(schema: JsonSchema): ValidateFunction {
  try { return new Ajv({ allErrors: true, strict: true }).compile(schema); }
  catch (error) { throw new TypeError(`Invalid output schema: ${error instanceof Error ? error.message : "unknown schema error"}`, { cause: error }); }
}
function schemaIssues(errors: ErrorObject[] | null | undefined): string[] { return (errors ?? []).slice(0, 20).map((issue) => `${issue.instancePath || "/"} ${issue.message ?? "is invalid"}`); }
function usage(value: Envelope["usage"], options: OpenAiCompatibleLlmOptions): LlmUsage {
  const inputTokens = naturalNumber(value.prompt_tokens); const outputTokens = naturalNumber(value.completion_tokens); const totalTokens = naturalNumber(value.total_tokens) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  const estimatedCostUsd = inputTokens !== null && outputTokens !== null && options.inputUsdPerMillionTokens !== undefined && options.outputUsdPerMillionTokens !== undefined
    ? (inputTokens * options.inputUsdPerMillionTokens + outputTokens * options.outputUsdPerMillionTokens) / 1_000_000 : null;
  return { inputTokens, outputTokens, totalTokens, estimatedCostUsd };
}
function validateRequest(request: StructuredGenerationRequest<unknown>) {
  boundedText(request.prompt, 500_000, "prompt");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(request.schemaName)) throw new TypeError("schemaName must contain 1-64 letters, digits, underscores, or hyphens");
  const maxBytes = request.maxOutputBytes ?? 1_000_000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 10_000_000) throw new TypeError("maxOutputBytes must be between 1 and 10000000");
  const maxTokens = request.maxOutputTokens ?? 4_096;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 100_000) throw new TypeError("maxOutputTokens must be between 1 and 100000");
  if (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) throw new TypeError("temperature must be between 0 and 2");
  if ((request.images?.length ?? 0) > 16 || request.images?.some((image) => image.dataBase64.length > 14_000_000)) throw new TypeError("images exceed the request limit");
}
function boundedText(value: string, max: number, name: string): string { if (!value.trim() || new TextEncoder().encode(value).byteLength > max) throw new TypeError(`${name} must contain 1-${max} bytes`); return value; }
function normalizeBaseUrl(value: string): string { const url = new URL(value); if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("LLM Base URL must use http or https"); if (url.username || url.password) throw new TypeError("LLM Base URL must not contain credentials"); return url.toString().replace(/\/$/, ""); }
export function isLocalLlmBaseUrl(value: string): boolean { const host = new URL(value).hostname; return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"; }
function isLocalBaseUrl(value: string): boolean { return isLocalLlmBaseUrl(value); }
function isOllamaBaseUrl(value: string): boolean { const url = new URL(value); return isLocalBaseUrl(value) && url.port === "11434"; }
function naturalNumber(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function optionalNonNegativeNumber(value: string | undefined, name: string): number | undefined { if (!value?.trim()) return undefined; const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0) throw new TypeError(`${name} must be a non-negative number`); return parsed; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function withTimeout(parent: AbortSignal | undefined, timeoutMs: number) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new TypeError("timeoutMs must be between 1 and 3600000");
  const controller = new AbortController(); const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener("abort", abort); } };
}

async function fetchWithRetry(fetcher: typeof globalThis.fetch, input: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetcher(input, init);
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel(); await retryDelay(signal); continue;
      }
      return response;
    } catch (error) {
      if (signal.aborted || attempt > 0) throw error;
      await retryDelay(signal);
    }
  }
}

function retryDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 50);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// Large bounded string repetitions can exceed llama.cpp's grammar expansion limit,
// especially in nested review arrays. The original schema still validates the response.
function ollamaGrammarSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ollamaGrammarSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "maxLength").map(([key,item]) => [key,ollamaGrammarSchema(item)]));
}
