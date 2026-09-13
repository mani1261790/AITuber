import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FISH_STANDARD_VOICE_ID, FishAudioTtsProvider } from "../packages/providers/dist/index.js";
import { budgetSpeech, createScriptBudget } from "./usage-budget.ts";

const apiKey = process.env.AITUBER_FISH_AUDIO_API_KEY?.trim() ?? "";
const model = process.env.AITUBER_FISH_AUDIO_MODEL?.trim() || "s2.1-pro-free";
const voiceId = process.env.AITUBER_FISH_AUDIO_VOICE_ID?.trim() || FISH_STANDARD_VOICE_ID;

if (!apiKey) {
  throw new Error("Fish Audio APIキーが未設定です。先に pnpm configure:tts を実行してください。");
}

process.stdout.write("1/2 Fish Audio APIキーを確認しています...\n");
const creditResponse = await fetch("https://api.fish.audio/wallet/self/api-credit?check_free_credit=true", {
  headers: { authorization: `Bearer ${apiKey}` },
});
if (!creditResponse.ok) {
  throw new Error(`Fish Audioの認証確認に失敗しました（HTTP ${creditResponse.status}）。APIキーを再確認してください。`);
}

process.stdout.write(`2/2 ${model} と標準音声でタイムスタンプ付き音声を生成しています...\n`);
const budget = createScriptBudget();
const artifact = await budgetSpeech(new FishAudioTtsProvider({ apiKey, model }), budget, model).synthesize({
  text: "AITuberの音声接続を確認します。頂点は、二、コンマ、マイナス一です。",
  language: "ja-JP",
  voiceId,
  dictionaryVersion: "verification.v1",
}, { signal: new AbortController().signal }).finally(() => budget.close());

const outputDirectory = resolve(".data/fish-audio-verification");
await mkdir(outputDirectory, { recursive: true });
const audioPath = resolve(outputDirectory, "verification.opus");
const resultPath = resolve(outputDirectory, "verification.json");
await Promise.all([
  writeFile(audioPath, artifact.audio),
  writeFile(resultPath, JSON.stringify({
    verifiedAt: new Date().toISOString(),
    provider: artifact.provider,
    model: artifact.model,
    voiceId: artifact.voiceId,
    firstAudioChunkMs: Math.round(artifact.firstAudioMs),
    artifactReadyMs: Math.round(artifact.synthesisMs),
    durationMs: artifact.durationMs,
    bytes: artifact.audio.byteLength,
    segmentCount: artifact.segments.length,
    audioPath,
  }, null, 2)),
]);

process.stdout.write(`接続確認に成功しました。\n音声: ${audioPath}\n結果: ${resultPath}\n`);
