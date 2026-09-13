import type { LlmContext, LlmProvider, LlmPurpose, OpenAiCompatibleLlmOptions, StructuredGenerationRequest } from "./llm.ts";
import type { SpeechArtifact, SpeechRequest, TextToSpeechProvider } from "./speech.ts";

export type UsageScope = "authoring" | "runtime";
export type UsageResource = "llm" | "tts";

export interface UsageReservation { readonly id: string; commit(): void }
export interface UsageBudget {
  reserve(input: { readonly scope: UsageScope; readonly resource: UsageResource; readonly maximumUnits: number; readonly maximumCostUsd: number | null; readonly requestedAt?: string }): UsageReservation;
}

export class BudgetedLlmProvider implements LlmProvider {
  readonly #backing: LlmProvider; readonly #budget: UsageBudget; readonly #scope: UsageScope;
  readonly #prices: Pick<OpenAiCompatibleLlmOptions, "inputUsdPerMillionTokens" | "outputUsdPerMillionTokens">;
  readonly #retryAttempts: number;
  constructor(options: { readonly backing: LlmProvider; readonly budget: UsageBudget; readonly scope: UsageScope; readonly inputUsdPerMillionTokens?: number; readonly outputUsdPerMillionTokens?: number; readonly retryAttempts?: number }) {
    this.#backing = options.backing; this.#budget = options.budget; this.#scope = options.scope;
    this.#prices = { ...(options.inputUsdPerMillionTokens !== undefined ? { inputUsdPerMillionTokens: options.inputUsdPerMillionTokens } : {}), ...(options.outputUsdPerMillionTokens !== undefined ? { outputUsdPerMillionTokens: options.outputUsdPerMillionTokens } : {}) };
    this.#retryAttempts = options.retryAttempts ?? 2;
    if (!Number.isSafeInteger(this.#retryAttempts) || this.#retryAttempts < 1 || this.#retryAttempts > 10) throw new TypeError("retryAttempts must be between 1 and 10");
    for (const price of Object.values(this.#prices)) if (!Number.isFinite(price) || price < 0) throw new TypeError("LLM prices must be non-negative");
  }
  createContext(options: { purpose: LlmPurpose; systemInstruction: string }): LlmContext {
    const backing = this.#backing.createContext(options);
    return { purpose: options.purpose, generate: async <T>(request: StructuredGenerationRequest<T>) => {
      const inputTokens = maximumInputTokens(options.systemInstruction, request); const outputTokens = request.maxOutputTokens ?? 4_096;
      if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > 100_000) throw new TypeError("maxOutputTokens must be between 1 and 100000");
      const maximumUnits = this.#retryAttempts * (inputTokens + outputTokens);
      const maximumCostUsd = llmMaximumCost(inputTokens, outputTokens, this.#retryAttempts, this.#prices);
      const reservation = this.#budget.reserve({ scope: this.#scope, resource: "llm", maximumUnits, maximumCostUsd });
      try { return await backing.generate(request); } finally { reservation.commit(); }
    } };
  }
}

export class BudgetedSpeechProvider implements TextToSpeechProvider {
  readonly provider: string; readonly model: string; readonly #backing: TextToSpeechProvider; readonly #budget: UsageBudget;
  readonly #scope: UsageScope; readonly #usdPerMillionCharacters: number | undefined;
  constructor(options: { readonly backing: TextToSpeechProvider; readonly budget: UsageBudget; readonly scope: UsageScope; readonly usdPerMillionCharacters?: number }) {
    this.#backing = options.backing; this.#budget = options.budget; this.#scope = options.scope; this.#usdPerMillionCharacters = options.usdPerMillionCharacters;
    if (this.#usdPerMillionCharacters !== undefined && (!Number.isFinite(this.#usdPerMillionCharacters) || this.#usdPerMillionCharacters < 0)) throw new TypeError("TTS price must be non-negative");
    this.provider = options.backing.provider; this.model = options.backing.model;
  }
  async synthesize(request: SpeechRequest, options: { signal: AbortSignal }): Promise<SpeechArtifact> {
    const characters = [...request.text].length;
    const maximumCostUsd = this.#usdPerMillionCharacters === undefined ? null : characters * this.#usdPerMillionCharacters / 1_000_000;
    const reservation = this.#budget.reserve({ scope: this.#scope, resource: "tts", maximumUnits: characters, maximumCostUsd });
    try { return await this.#backing.synthesize(request, options); } finally { reservation.commit(); }
  }
}

function maximumInputTokens(systemInstruction: string, request: StructuredGenerationRequest<unknown>): number {
  const textBytes = byteLength(systemInstruction) + byteLength(request.prompt) + byteLength(JSON.stringify(request.schema));
  const imageBytes = (request.images ?? []).reduce((sum, image) => sum + Math.ceil(image.dataBase64.length * 3 / 4), 0);
  return Math.max(1, textBytes + imageBytes + 4_096);
}
function llmMaximumCost(inputTokens: number, outputTokens: number, attempts: number, prices: Pick<OpenAiCompatibleLlmOptions, "inputUsdPerMillionTokens" | "outputUsdPerMillionTokens">): number | null {
  if (prices.inputUsdPerMillionTokens === undefined || prices.outputUsdPerMillionTokens === undefined) return null;
  return attempts * (inputTokens * prices.inputUsdPerMillionTokens + outputTokens * prices.outputUsdPerMillionTokens) / 1_000_000;
}
function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }
