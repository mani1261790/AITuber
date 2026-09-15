import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FishAudioTtsProvider } from "../packages/providers/dist/index.js";
import { budgetSpeech, createScriptBudget } from "./usage-budget.ts";

const voices = [
  { name: "anime-teacher", label: "Anime voice：表情豊かな日本語アニメ声", id: "4a56e31b2ec54484972040592c8ba7e2" },
  { name: "anime-bright", label: "Anime：高めで明るい日本語アニメ声", id: "af5846c4409241f3be2d51525a295d34" },
  { name: "akari", label: "あかり：明るく表情豊か", id: "97eda32449cf443bbc4b8782853ca554" },
  { name: "shiori", label: "しおり：柔らかく穏やか", id: "5da7f24e9e274f91b2b677669c818ce9" },
  { name: "kyoko", label: "きょうこ：これまでの声", id: "b2d9d8db057042688a5e318b8f405bc2" },
];
const selectedNames = process.argv.slice(2);
const selectedVoices = voices.filter(voice => selectedNames.length === 0 || selectedNames.includes(voice.name));
if (!selectedVoices.length) throw new Error("該当する声がありません");
const text = "こんにちは。今日は、平方完成を一緒に見ていきましょう。エックスの二乗、マイナス四エックス、プラス三。この式は、エックスひく二の二乗、ひく一、と書き換えられます。グラフの頂点は、二、コンマ、マイナス一です。ここまで、大丈夫かな？";
const apiKey = process.env.AITUBER_FISH_AUDIO_API_KEY?.trim();
if (!apiKey) throw new Error("先に pnpm configure:tts でAPIキーを設定してください。");
const directory = resolve(".data/voice-preview");
await mkdir(directory, { recursive: true });
const budget = createScriptBudget();
const model = "s2.1-pro-free";
const provider = budgetSpeech(new FishAudioTtsProvider({ apiKey, model }), budget, model);
const results = [];
try {
  for (const voice of selectedVoices) {
    const artifact = await provider.synthesize({ text, language: "ja-JP", voiceId: voice.id, dictionaryVersion: "voice-preview.v1" }, { signal: AbortSignal.timeout(120_000) });
    if (artifact.audio.length === 0 || artifact.durationMs <= 0) throw new Error(`${voice.name}: 音声が空です`);
    const audioPath = resolve(directory, `${voice.name}.opus`);
    await writeFile(audioPath, artifact.audio);
    results.push({ ...voice, audioPath, durationMs: artifact.durationMs });
    console.log(`${voice.label}: ${audioPath} (${Math.round(artifact.durationMs / 1000)}秒)`);
  }
  await writeFile(resolve(directory, "manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), model, text, voices: results }, null, 2));
} finally { budget.close(); }
