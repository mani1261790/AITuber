import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LlmSettingsView, UpdateLlmSettingsRequest } from "@aituber/contracts";
import { OpenAiCompatibleLlmProvider, openAiCompatibleOptionsFromEnv, type OpenAiCompatibleLlmOptions } from "@aituber/providers";

interface StoredLlmSettings { apiKey: string; model: string; baseUrl: string }

export class LlmSettingsStore {
  readonly #path: string;
  #value: StoredLlmSettings;

  constructor(path: string, env: Readonly<Record<string, string | undefined>> = process.env) {
    this.#path = path;
    const configured = openAiCompatibleOptionsFromEnv(env);
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
    return openAiCompatibleOptionsFromEnv({ AITUBER_LLM_API_KEY: this.#value.apiKey, AITUBER_LLM_MODEL: this.#value.model, AITUBER_LLM_BASE_URL: this.#value.baseUrl });
  }
}

function parseStored(text: string): StoredLlmSettings {
  const value = JSON.parse(text) as Partial<StoredLlmSettings>;
  if (typeof value.apiKey !== "string" || typeof value.model !== "string" || typeof value.baseUrl !== "string") throw new TypeError("Stored LLM settings are invalid");
  return { apiKey: value.apiKey, model: value.model, baseUrl: value.baseUrl };
}
