import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AfterClassStore, DataRetentionStore, LearningEvidenceStore, LectureEventStore, LiveSupplementStore, QuestionStore, ResourceBudgetStore } from "@aituber/storage";
import { BudgetedSpeechProvider, CachedSpeechProvider, FISH_STANDARD_VOICE_ID, FishAudioTtsProvider, IrodoriTtsProvider, TestToneSpeechProvider, type TextToSpeechProvider } from "@aituber/providers";
import { createApp } from "./app.ts";
import { FixedLectureService } from "./fixed-lecture-service.ts";
import { LlmSettingsStore } from "./llm-settings-store.ts";
import { createLessonPlanner } from "./lesson-director.ts";
import { CourseAuthoringService } from "./course-authoring-service.ts";
import { createCommentClassifier } from "./comment-classifier.ts";
import { QuestionQueueService } from "./question-queue-service.ts";
import { LiveSupplementService } from "./live-supplement-service.ts";
import { PedagogyService } from "./pedagogy-service.ts";
import { AfterClassService } from "./after-class-service.ts";
import { DataRetentionService } from "./data-retention-service.ts";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.AITUBER_PORT ?? "4310", 10);
const dataDirectory = resolve(process.env.AITUBER_DATA_DIR ?? ".data");
const databasePath = resolve(process.env.AITUBER_DB_PATH ?? join(dataDirectory, "aituber.db"));
const llmSettingsPath = resolve(process.env.AITUBER_LLM_SETTINGS_PATH ?? join(dataDirectory, "llm-settings.json"));
const authoringPath = resolve(process.env.AITUBER_AUTHORING_PATH ?? join(dataDirectory, "authoring"));
const ttsCachePath = resolve(process.env.AITUBER_TTS_CACHE_PATH ?? join(dataDirectory, "tts-cache"));
const playbackUnitMs = Number.parseInt(process.env.AITUBER_FIXED_PLAYBACK_MS ?? "2000", 10);
const fishApiKey = process.env.AITUBER_FISH_AUDIO_API_KEY ?? "";
const fishVoiceId = process.env.AITUBER_FISH_AUDIO_VOICE_ID ?? FISH_STANDARD_VOICE_ID;
const ttsTestMode = process.env.AITUBER_TTS_TEST_MODE ?? "";
const authoringDailyBudgetUsd = optionalNonNegativeNumber(process.env.AITUBER_AUTHORING_DAILY_BUDGET_USD, "AITUBER_AUTHORING_DAILY_BUDGET_USD");
const runtimeDailyBudgetUsd = optionalNonNegativeNumber(process.env.AITUBER_RUNTIME_DAILY_BUDGET_USD, "AITUBER_RUNTIME_DAILY_BUDGET_USD");
const authoringDailyTokenLimit = optionalNonNegativeInteger(process.env.AITUBER_AUTHORING_DAILY_LLM_TOKEN_LIMIT, "AITUBER_AUTHORING_DAILY_LLM_TOKEN_LIMIT");
const runtimeDailyTokenLimit = optionalNonNegativeInteger(process.env.AITUBER_RUNTIME_DAILY_LLM_TOKEN_LIMIT, "AITUBER_RUNTIME_DAILY_LLM_TOKEN_LIMIT");
const runtimeDailyTtsCharacterLimit = optionalNonNegativeInteger(process.env.AITUBER_RUNTIME_DAILY_TTS_CHARACTER_LIMIT, "AITUBER_RUNTIME_DAILY_TTS_CHARACTER_LIMIT");

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("AITUBER_PORT must be an integer between 1 and 65535");
if (!Number.isSafeInteger(playbackUnitMs) || playbackUnitMs < 100) throw new Error("AITUBER_FIXED_PLAYBACK_MS must be at least 100");

mkdirSync(dirname(databasePath), { recursive: true });
const store = new LectureEventStore(databasePath);
const questionStore = new QuestionStore(databasePath);
const supplementStore = new LiveSupplementStore(databasePath);
const evidenceStore = new LearningEvidenceStore(databasePath);
const afterClassStore = new AfterClassStore(databasePath);
const resourceBudgetStore = new ResourceBudgetStore(databasePath,
  { ...(authoringDailyBudgetUsd !== undefined ? { authoring: authoringDailyBudgetUsd } : {}), ...(runtimeDailyBudgetUsd !== undefined ? { runtime: runtimeDailyBudgetUsd } : {}) },
  { ...(authoringDailyTokenLimit !== undefined ? { "authoring:llm": authoringDailyTokenLimit } : {}), ...(runtimeDailyTokenLimit !== undefined ? { "runtime:llm": runtimeDailyTokenLimit } : {}), ...(runtimeDailyTtsCharacterLimit !== undefined ? { "runtime:tts": runtimeDailyTtsCharacterLimit } : {}) });
const dataRetentionStore = new DataRetentionStore(databasePath);
const dataRetention = new DataRetentionService({ store: dataRetentionStore, cacheDirectories: [ttsCachePath] });
await dataRetention.purgeNow(); dataRetention.start();
let speechProvider: TextToSpeechProvider | undefined;
let voiceId = fishVoiceId;
if (ttsTestMode === "tone") {
  speechProvider = new TestToneSpeechProvider(playbackUnitMs);
  voiceId = "voice.test-tone";
} else if (ttsTestMode === "failure") {
  speechProvider = { provider: "failure-fixture", model: "failure-v1", synthesize: async () => { throw new Error("Injected TTS failure"); } };
  voiceId = "voice.failure-fixture";
} else if (process.env.AITUBER_TTS_PROVIDER === "irodori") {
  voiceId = "teacher";
  speechProvider = new CachedSpeechProvider(new BudgetedSpeechProvider({ backing: new IrodoriTtsProvider({
    ...(process.env.AITUBER_IRODORI_ENDPOINT ? { endpoint: process.env.AITUBER_IRODORI_ENDPOINT } : {}),
    ...(process.env.AITUBER_IRODORI_VOICE_REVISION ? { voiceRevision: process.env.AITUBER_IRODORI_VOICE_REVISION } : {}),
  }), budget: resourceBudgetStore, scope: "runtime", usdPerMillionCharacters: 0 }), ttsCachePath);
} else if (fishApiKey && fishVoiceId) {
  const model = process.env.AITUBER_FISH_AUDIO_MODEL ?? "s2.1-pro-free";
  const price = model === "s2.1-pro-free" ? 0 : optionalNonNegativeNumber(process.env.AITUBER_TTS_USD_PER_MILLION_CHARACTERS, "AITUBER_TTS_USD_PER_MILLION_CHARACTERS");
  speechProvider = new CachedSpeechProvider(new BudgetedSpeechProvider({ backing: new FishAudioTtsProvider({ apiKey: fishApiKey, model }), budget: resourceBudgetStore, scope: "runtime", ...(price !== undefined ? { usdPerMillionCharacters: price } : {}) }), ttsCachePath);
}
const llmSettings = new LlmSettingsStore(llmSettingsPath, process.env, resourceBudgetStore);
const lecture = new FixedLectureService({ store, playbackUnitMs, ...(speechProvider ? { speechProvider, voiceId } : {}), ...(ttsTestMode ? {} : { planner: createLessonPlanner(() => { try { return llmSettings.createProvider("runtime"); } catch { return null; } }) }) });
const authoring = new CourseAuthoringService({ directory: authoringPath, llm: () => llmSettings.createProvider("authoring"), onAvailable: (course) => lecture.registerCourse(course) });
authoring.list().forEach((job) => { if (job.course) lecture.registerCourse(job.course); });
let pedagogy: PedagogyService | null = null;
const questions = new QuestionQueueService({ classifier: createCommentClassifier(() => { try { return llmSettings.createProvider("runtime"); } catch { return null; } }), store: questionStore, context: (sessionId) => ({ session: lecture.getSession(sessionId), remainingMs: lecture.getRemainingTimeMs(sessionId) }), onQuestion: (input) => pedagogy?.recordQuestion(input) });
pedagogy = new PedagogyService({ store: evidenceStore, lecture, questions });
const supplements = new LiveSupplementService({ store: supplementStore, questions, lecture, llm: () => { try { return llmSettings.createProvider("runtime"); } catch { return null; } } });
const afterClass = new AfterClassService({ store: afterClassStore, questions, lecture, llm: () => { try { return llmSettings.createProvider("runtime"); } catch { return null; } } });
const server = createApp(lecture, llmSettings, authoring, questions, pedagogy, afterClass);

server.listen(port, host, () => {
  const lanHost = process.env.AITUBER_LAN_HOST ?? host;
  process.stdout.write(`AITuber API: http://${host}:${port}\nOperator: http://127.0.0.1:4312\nClassroom: http://${lanHost}:4311\n`);
});

function shutdown() {
  dataRetention.close();
  afterClass.close();
  questions.close();
  supplements.close();
  lecture.close();
  server.emit("aituber:shutdown");
  server.close((error) => {
    store.close();
    questionStore.close();
    supplementStore.close();
    evidenceStore.close();
    afterClassStore.close();
    resourceBudgetStore.close();
    dataRetentionStore.close();
    if (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function optionalNonNegativeNumber(value: string | undefined, name: string): number | undefined {
  if (!value?.trim()) return undefined; const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
}
function optionalNonNegativeInteger(value: string | undefined, name: string): number | undefined { const parsed = optionalNonNegativeNumber(value, name); if (parsed !== undefined && !Number.isSafeInteger(parsed)) throw new Error(`${name} must be a non-negative integer`); return parsed; }
