import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { LectureEventStore } from "@aituber/storage";
import { CachedSpeechProvider, FISH_STANDARD_VOICE_ID, FishAudioTtsProvider, TestToneSpeechProvider, type TextToSpeechProvider } from "@aituber/providers";
import { createApp } from "./app.ts";
import { FixedLectureService } from "./fixed-lecture-service.ts";

const host = process.env.AITUBER_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.AITUBER_PORT ?? "4310", 10);
const databasePath = resolve(process.env.AITUBER_DB_PATH ?? ".data/aituber.db");
const playbackUnitMs = Number.parseInt(process.env.AITUBER_FIXED_PLAYBACK_MS ?? "2000", 10);
const fishApiKey = process.env.AITUBER_FISH_AUDIO_API_KEY ?? "";
const fishVoiceId = process.env.AITUBER_FISH_AUDIO_VOICE_ID ?? FISH_STANDARD_VOICE_ID;
const ttsTestMode = process.env.AITUBER_TTS_TEST_MODE ?? "";

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("AITUBER_PORT must be an integer between 1 and 65535");
if (!Number.isSafeInteger(playbackUnitMs) || playbackUnitMs < 100) throw new Error("AITUBER_FIXED_PLAYBACK_MS must be at least 100");

mkdirSync(dirname(databasePath), { recursive: true });
const store = new LectureEventStore(databasePath);
let speechProvider: TextToSpeechProvider | undefined;
let voiceId = fishVoiceId;
if (ttsTestMode === "tone") {
  speechProvider = new TestToneSpeechProvider(playbackUnitMs);
  voiceId = "voice.test-tone";
} else if (ttsTestMode === "failure") {
  speechProvider = { provider: "failure-fixture", model: "failure-v1", synthesize: async () => { throw new Error("Injected TTS failure"); } };
  voiceId = "voice.failure-fixture";
} else if (fishApiKey && fishVoiceId) {
  speechProvider = new CachedSpeechProvider(new FishAudioTtsProvider({ apiKey: fishApiKey, model: process.env.AITUBER_FISH_AUDIO_MODEL ?? "s2-pro" }), resolve(".data/tts-cache"));
}
const lecture = new FixedLectureService({ store, playbackUnitMs, ...(speechProvider ? { speechProvider, voiceId } : {}) });
const server = createApp(lecture);

server.listen(port, host, () => {
  process.stdout.write(`AITuber server listening on http://${host}:${port}\n`);
});

function shutdown() {
  lecture.close();
  server.close((error) => {
    store.close();
    if (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
