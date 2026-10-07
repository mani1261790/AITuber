import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "@aituber/runtime-platform/files";
import { dirname } from "node:path";
import type { LlmSettingsView, UpdateLlmSettingsRequest } from "@aituber/contracts";
import { BudgetedLlmProvider, isLocalLlmBaseUrl, OpenAiCompatibleLlmProvider, openAiCompatibleOptionsFromEnv, type LlmProvider, type OpenAiCompatibleLlmOptions, type UsageBudget, type UsageScope } from "@aituber/providers";

interface StoredLlmSettings { apiKey: string; model: string; baseUrl: string }

export class LlmSettingsStore {
  readonly #path: string;
  readonly #pricing: Pick<OpenAiCompatibleLlmOptions, "inputUsdPerMillionTokens" | "outputUsdPerMillionTokens">;
  readonly #usageBudget: UsageBudget | null;
  #value: StoredLlmSettings;

  constructor(path: string, env: Readonly<Record<string, string | undefined>> = process.env, usageBudget: UsageBudget | null = null) {
    this.#path = path;
    const configured = openAiCompatibleOptionsFromEnv(env);
    const inputPrice = optionalNonNegativeNumber(env.AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS, "AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS"); const outputPrice = optionalNonNegativeNumber(env.AITUBER_LLM_OUTPUT_USD_PER_MILLION_TOKENS, "AITUBER_LLM_OUTPUT_USD_PER_MILLION_TOKENS");
    this.#pricing = { ...(inputPrice !== undefined ? { inputUsdPerMillionTokens: inputPrice } : {}), ...(outputPrice !== undefined ? { outputUsdPerMillionTokens: outputPrice } : {}) };
    this.#usageBudget = usageBudget;
    this.#value = existsSync(path) ? parseStored(readFileSync(path, "utf8")) : { apiKey: configured?.apiKey ?? "", model: configured?.model ?? "", baseUrl: configured?.baseUrl ?? "" };
  }

  get(): LlmSettingsView { return { apiKeyConfigured: Boolean(this.#value.apiKey), model: this.#value.model, baseUrl: this.#value.baseUrl }; }

  save(request: UpdateLlmSettingsRequest): LlmSettingsView {
    const next = { apiKey: request.apiKey?.trim() || this.#value.apiKey, model: request.model.trim(), baseUrl: request.baseUrl?.trim() ?? "" };
    const options = openAiCompatibleOptionsFromEnv({ AITUBER_LLM_API_KEY: next.apiKey, AITUBER_LLM_MODEL: next.model, AITUBER_LLM_BASE_URL: next.baseUrl });
    if (options) new OpenAiCompatibleLlmProvider(options);
    mkdirSync(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.#path); chmodSync(this.#path, 0o600);
    this.#value = next;
    return this.get();
  }

  connectionOptions(): OpenAiCompatibleLlmOptions | null {
    const options = openAiCompatibleOptionsFromEnv({ AITUBER_LLM_API_KEY: this.#value.apiKey, AITUBER_LLM_MODEL: this.#value.model, AITUBER_LLM_BASE_URL: this.#value.baseUrl });
    return options ? { ...options, ...this.#pricing } : null;
  }

  createProvider(scope: UsageScope = "runtime"): LlmProvider {
    const options = this.connectionOptions();
    if (!options) throw new TypeError("LLM接続を先に設定してください。");
    const backing = new OpenAiCompatibleLlmProvider({ ...options, timeoutMs: scope === "authoring" ? 3_600_000 : options.baseUrl && isLocalLlmBaseUrl(options.baseUrl) ? 90_000 : 30_000 });
    if (!this.#usageBudget) return backing;
    const freeLocal = Boolean(options.baseUrl && isLocalLlmBaseUrl(options.baseUrl));
    const inputPrice = options.inputUsdPerMillionTokens ?? (freeLocal ? 0 : undefined); const outputPrice = options.outputUsdPerMillionTokens ?? (freeLocal ? 0 : undefined);
    return new BudgetedLlmProvider({ backing, budget: this.#usageBudget, scope,
      ...(inputPrice !== undefined ? { inputUsdPerMillionTokens: inputPrice } : {}),
      ...(outputPrice !== undefined ? { outputUsdPerMillionTokens: outputPrice } : {}) });
  }
}

function parseStored(text: string): StoredLlmSettings {
  const value = JSON.parse(text) as Partial<StoredLlmSettings>;
  if (typeof value.apiKey !== "string" || typeof value.model !== "string" || typeof value.baseUrl !== "string") throw new TypeError("Stored LLM settings are invalid");
  return { apiKey: value.apiKey, model: value.model, baseUrl: value.baseUrl };
}

function optionalNonNegativeNumber(value: string | undefined, name: string): number | undefined { if (!value?.trim()) return undefined; const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0) throw new TypeError(`${name} must be a non-negative number`); return parsed; }
