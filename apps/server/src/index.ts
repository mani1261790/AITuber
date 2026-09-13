import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { LearningEvidenceStore, LectureEventStore, LiveSupplementStore, QuestionStore } from "@aituber/storage";
import { CachedSpeechProvider, FISH_STANDARD_VOICE_ID, FishAudioTtsProvider, TestToneSpeechProvider, type TextToSpeechProvider } from "@aituber/providers";
import { createApp } from "./app.ts";
import { FixedLectureService } from "./fixed-lecture-service.ts";
import { LlmSettingsStore } from "./llm-settings-store.ts";
import { CourseAuthoringService } from "./course-authoring-service.ts";
import { QuestionQueueService } from "./question-queue-service.ts";
import { LiveSupplementService } from "./live-supplement-service.ts";
import { PedagogyService } from "./pedagogy-service.ts";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.AITUBER_PORT ?? "4310", 10);
const databasePath = resolve(process.env.AITUBER_DB_PATH ?? ".data/aituber.db");
const llmSettingsPath = resolve(process.env.AITUBER_LLM_SETTINGS_PATH ?? ".data/llm-settings.json");
const authoringPath = resolve(process.env.AITUBER_AUTHORING_PATH ?? ".data/authoring");
const playbackUnitMs = Number.parseInt(process.env.AITUBER_FIXED_PLAYBACK_MS ?? "2000", 10);
const fishApiKey = process.env.AITUBER_FISH_AUDIO_API_KEY ?? "";
const fishVoiceId = process.env.AITUBER_FISH_AUDIO_VOICE_ID ?? FISH_STANDARD_VOICE_ID;
const ttsTestMode = process.env.AITUBER_TTS_TEST_MODE ?? "";

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("AITUBER_PORT must be an integer between 1 and 65535");
if (!Number.isSafeInteger(playbackUnitMs) || playbackUnitMs < 100) throw new Error("AITUBER_FIXED_PLAYBACK_MS must be at least 100");

mkdirSync(dirname(databasePath), { recursive: true });
const store = new LectureEventStore(databasePath);
const questionStore = new QuestionStore(databasePath);
const supplementStore = new LiveSupplementStore(databasePath);
const evidenceStore = new LearningEvidenceStore(databasePath);
let speechProvider: TextToSpeechProvider | undefined;
let voiceId = fishVoiceId;
if (ttsTestMode === "tone") {
  speechProvider = new TestToneSpeechProvider(playbackUnitMs);
  voiceId = "voice.test-tone";
} else if (ttsTestMode === "failure") {
  speechProvider = { provider: "failure-fixture", model: "failure-v1", synthesize: async () => { throw new Error("Injected TTS failure"); } };
  voiceId = "voice.failure-fixture";
} else if (fishApiKey && fishVoiceId) {
  speechProvider = new CachedSpeechProvider(new FishAudioTtsProvider({ apiKey: fishApiKey, model: process.env.AITUBER_FISH_AUDIO_MODEL ?? "s2.1-pro-free" }), resolve(".data/tts-cache"));
}
const lecture = new FixedLectureService({ store, playbackUnitMs, ...(speechProvider ? { speechProvider, voiceId } : {}) });
const llmSettings = new LlmSettingsStore(llmSettingsPath);
const authoring = new CourseAuthoringService({ directory: authoringPath, llm: () => llmSettings.createProvider(), onAvailable: (course) => lecture.registerCourse(course) });
authoring.list().forEach((job) => { if (job.course) lecture.registerCourse(job.course); });
let pedagogy: PedagogyService | null = null;
const questions = new QuestionQueueService({ store: questionStore, context: (sessionId) => ({ session: lecture.getSession(sessionId), remainingMs: lecture.getRemainingTimeMs(sessionId) }), onQuestion: (input) => pedagogy?.recordQuestion(input) });
pedagogy = new PedagogyService({ store: evidenceStore, lecture, questions });
const supplements = new LiveSupplementService({ store: supplementStore, questions, lecture, llm: () => { try { return llmSettings.createProvider(); } catch { return null; } } });
const server = createApp(lecture, llmSettings, authoring, questions, pedagogy);

server.listen(port, host, () => {
  const lanHost = process.env.AITUBER_LAN_HOST ?? host;
  process.stdout.write(`AITuber API: http://${host}:${port}\nOperator: http://127.0.0.1:4312\nClassroom: http://${lanHost}:4311\n`);
});

function shutdown() {
  supplements.close();
  lecture.close();
  server.emit("aituber:shutdown");
  server.close((error) => {
    store.close();
    questionStore.close();
    supplementStore.close();
    evidenceStore.close();
    if (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
