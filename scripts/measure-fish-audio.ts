import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FISH_STANDARD_VOICE_ID, FishAudioTtsProvider } from "../packages/providers/src/index.ts";

const apiKey = process.env.AITUBER_FISH_AUDIO_API_KEY ?? "";
const voiceId = process.env.AITUBER_FISH_AUDIO_VOICE_ID ?? FISH_STANDARD_VOICE_ID;
const model = process.env.AITUBER_FISH_AUDIO_MODEL ?? "s2-pro";
if (!apiKey) throw new Error("AITUBER_FISH_AUDIO_API_KEY is required");

const samples = [
  { id: "math", text: "二次関数 y イコール、かっこ x ひく2、の二乗、ひく1の頂点は、2コンマ、マイナス1です。" },
  { id: "biology", text: "DNAポリメラーゼは、ファイブプライムからスリープライムの向きへ新しい鎖を伸ばします。" },
  { id: "vae", text: "VAEでは、z イコール mu たす sigma かける epsilon と計算し、ELBOを最適化します。" },
  { id: "long", text: "まず二次関数を頂点形式へ直し、頂点と対称軸を読み取ります。次にDNA複製では、ヘリカーゼ、プライマーゼ、DNAポリメラーゼ、DNAリガーゼの順を確認します。最後にVAEの再パラメータ化では、標準正規分布から引いたepsilonへ確率性を分離し、muとsigmaへ勾配を流せる理由を説明します。これら三つの例を通して、記号と概念の対応を一つずつ言葉にしてください。" },
] as const;

const provider = new FishAudioTtsProvider({ apiKey, model });
const timestamp = new Date().toISOString().replaceAll(":", "-");
const outputDirectory = resolve(".data/fish-audio-measurements", timestamp);
await mkdir(outputDirectory, { recursive: true });
const measurements = [];

for (const sample of samples) {
  const artifact = await provider.synthesize({ text: sample.text, language: "ja-JP", voiceId, dictionaryVersion: "measurement.v1" }, { signal: new AbortController().signal });
  await writeFile(resolve(outputDirectory, `${sample.id}.opus`), artifact.audio);
  measurements.push({ id: sample.id, text: sample.text, provider: artifact.provider, model: artifact.model, voiceId: artifact.voiceId, firstAudioMs: Math.round(artifact.firstAudioMs), durationMs: artifact.durationMs, bytes: artifact.audio.byteLength, segmentCount: artifact.segments.length });
}

await writeFile(resolve(outputDirectory, "measurements.json"), JSON.stringify({ measuredAt: new Date().toISOString(), measurements }, null, 2));
process.stdout.write(`${resolve(outputDirectory, "measurements.json")}\n`);
