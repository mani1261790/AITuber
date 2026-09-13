import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { BudgetedLlmProvider, BudgetedSpeechProvider, isLocalLlmBaseUrl, type LlmProvider, type OpenAiCompatibleLlmOptions, type TextToSpeechProvider, type UsageScope } from "../packages/providers/dist/index.js";
import { ResourceBudgetStore } from "../packages/storage/dist/index.js";

export function createScriptBudget(env: Readonly<Record<string, string | undefined>> = process.env): ResourceBudgetStore {
  const dataDirectory = resolve(env.AITUBER_DATA_DIR ?? ".data");
  const path = resolve(env.AITUBER_DB_PATH ?? join(dataDirectory, "aituber.db")); mkdirSync(dirname(path), { recursive: true });
  const authoring = optionalNumber(env.AITUBER_AUTHORING_DAILY_BUDGET_USD, "AITUBER_AUTHORING_DAILY_BUDGET_USD");
  const runtime = optionalNumber(env.AITUBER_RUNTIME_DAILY_BUDGET_USD, "AITUBER_RUNTIME_DAILY_BUDGET_USD");
  const authoringTokens = optionalInteger(env.AITUBER_AUTHORING_DAILY_LLM_TOKEN_LIMIT, "AITUBER_AUTHORING_DAILY_LLM_TOKEN_LIMIT"); const runtimeTokens = optionalInteger(env.AITUBER_RUNTIME_DAILY_LLM_TOKEN_LIMIT, "AITUBER_RUNTIME_DAILY_LLM_TOKEN_LIMIT"); const runtimeCharacters = optionalInteger(env.AITUBER_RUNTIME_DAILY_TTS_CHARACTER_LIMIT, "AITUBER_RUNTIME_DAILY_TTS_CHARACTER_LIMIT");
  return new ResourceBudgetStore(path, { ...(authoring !== undefined ? { authoring } : {}), ...(runtime !== undefined ? { runtime } : {}) }, { ...(authoringTokens !== undefined ? { "authoring:llm": authoringTokens } : {}), ...(runtimeTokens !== undefined ? { "runtime:llm": runtimeTokens } : {}), ...(runtimeCharacters !== undefined ? { "runtime:tts": runtimeCharacters } : {}) });
}

export function budgetLlm(backing: LlmProvider, budget: ResourceBudgetStore, options: OpenAiCompatibleLlmOptions, scope: UsageScope): LlmProvider {
  const freeLocal = Boolean(options.baseUrl && isLocalLlmBaseUrl(options.baseUrl)); const input = options.inputUsdPerMillionTokens ?? (freeLocal ? 0 : undefined); const output = options.outputUsdPerMillionTokens ?? (freeLocal ? 0 : undefined);
  return new BudgetedLlmProvider({ backing, budget, scope, ...(input !== undefined ? { inputUsdPerMillionTokens: input } : {}), ...(output !== undefined ? { outputUsdPerMillionTokens: output } : {}) });
}

export function budgetSpeech(backing: TextToSpeechProvider, budget: ResourceBudgetStore, model: string): TextToSpeechProvider {
  const price = model === "s2.1-pro-free" ? 0 : optionalNumber(process.env.AITUBER_TTS_USD_PER_MILLION_CHARACTERS, "AITUBER_TTS_USD_PER_MILLION_CHARACTERS");
  return new BudgetedSpeechProvider({ backing, budget, scope: "runtime", ...(price !== undefined ? { usdPerMillionCharacters: price } : {}) });
}

function optionalNumber(value: string | undefined, name: string): number | undefined { if (!value?.trim()) return undefined; const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`); return parsed; }
function optionalInteger(value: string | undefined, name: string): number | undefined { const parsed = optionalNumber(value, name); if (parsed !== undefined && !Number.isSafeInteger(parsed)) throw new Error(`${name} must be a non-negative integer`); return parsed; }
