import { OpenAiCompatibleLlmProvider, openAiCompatibleOptionsFromEnv } from "../packages/providers/src/index.ts";
import { budgetLlm, createScriptBudget } from "./usage-budget.ts";

const options = openAiCompatibleOptionsFromEnv(process.env);
if (!options) throw new Error("LLM接続が未設定です。先に pnpm configure:llm を実行してください。");

const budget = createScriptBudget();
const provider = budgetLlm(new OpenAiCompatibleLlmProvider({ ...options, timeoutMs: 30_000, maxOutputBytes: 16_384 }), budget, options, "runtime");
process.stdout.write(`${options.baseUrl ? "指定したOpenAI互換エンドポイント" : "OpenAI API"}へ構造化応答を要求しています...\n`);
try { const result = await provider.createContext({ purpose: "review", systemInstruction: "You verify connectivity. Return only the requested structured result." }).generate<{ ok: true; message: string }>({
  prompt: "Return ok=true and a short Japanese message confirming the connection.",
  schemaName: "aituber_connection_check",
  schema: {
    type: "object", additionalProperties: false, required: ["ok", "message"],
    properties: { ok: { const: true }, message: { type: "string", minLength: 1, maxLength: 80 } },
  },
  maxOutputTokens: 128,
});

process.stdout.write(`接続確認に成功しました。model=${result.model} input=${result.usage.inputTokens ?? "unknown"} output=${result.usage.outputTokens ?? "unknown"} latencyMs=${Math.round(result.latencyMs)}\n`);
} finally { budget.close(); }
