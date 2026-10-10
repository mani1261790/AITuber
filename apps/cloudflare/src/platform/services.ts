

import { AfterClassStore, DataRetentionStore, LearningEvidenceStore, LectureEventStore, LiveSupplementStore, QuestionStore, ResourceBudgetStore } from "@aituber/storage";
import { BudgetedSpeechProvider, CachedSpeechProvider, FISH_STANDARD_VOICE_ID, FishAudioTtsProvider, IrodoriTtsProvider, TestToneSpeechProvider, type TextToSpeechProvider } from "@aituber/providers";

import { FixedLectureService } from "../../../server/src/fixed-lecture-service.ts";
import { LlmSettingsStore } from "../../../server/src/llm-settings-store.ts";
import { createLessonPlanner } from "../../../server/src/lesson-director.ts";
import { CourseAuthoringService } from "../../../server/src/course-authoring-service.ts";
import { createCommentClassifier } from "../../../server/src/comment-classifier.ts";
import { QuestionQueueService } from "../../../server/src/question-queue-service.ts";
import { LiveSupplementService } from "../../../server/src/live-supplement-service.ts";
import { PedagogyService } from "../../../server/src/pedagogy-service.ts";
import { AfterClassService } from "../../../server/src/after-class-service.ts";
import { DataRetentionService } from "../../../server/src/data-retention-service.ts";


export function createServices(env: Record<string,string|undefined>, schedule: () => void) {
const databasePath="/data/aituber.db", llmSettingsPath="/data/llm-settings.json", authoringPath="/data/authoring", ttsCachePath="/data/tts-cache";
const playbackUnitMs = Number.parseInt(env.AITUBER_FIXED_PLAYBACK_MS ?? "2000", 10);
const fishApiKey = env.AITUBER_FISH_AUDIO_API_KEY ?? "";
const fishVoiceId = env.AITUBER_FISH_AUDIO_VOICE_ID ?? FISH_STANDARD_VOICE_ID;
const ttsTestMode = env.AITUBER_TTS_TEST_MODE ?? "";
const authoringDailyBudgetUsd = optionalNonNegativeNumber(env.AITUBER_AUTHORING_DAILY_BUDGET_USD, "AITUBER_AUTHORING_DAILY_BUDGET_USD");
const runtimeDailyBudgetUsd = optionalNonNegativeNumber(env.AITUBER_RUNTIME_DAILY_BUDGET_USD, "AITUBER_RUNTIME_DAILY_BUDGET_USD");
const authoringDailyTokenLimit = optionalNonNegativeInteger(env.AITUBER_AUTHORING_DAILY_LLM_TOKEN_LIMIT, "AITUBER_AUTHORING_DAILY_LLM_TOKEN_LIMIT");
const runtimeDailyTokenLimit = optionalNonNegativeInteger(env.AITUBER_RUNTIME_DAILY_LLM_TOKEN_LIMIT, "AITUBER_RUNTIME_DAILY_LLM_TOKEN_LIMIT");
const runtimeDailyTtsCharacterLimit = optionalNonNegativeInteger(env.AITUBER_RUNTIME_DAILY_TTS_CHARACTER_LIMIT, "AITUBER_RUNTIME_DAILY_TTS_CHARACTER_LIMIT");

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
let speechProvider: TextToSpeechProvider | undefined;
let voiceId = fishVoiceId;
if (ttsTestMode === "tone") {
  speechProvider = new TestToneSpeechProvider(playbackUnitMs);
  voiceId = "voice.test-tone";
} else if (ttsTestMode === "failure") {
  speechProvider = { provider: "failure-fixture", model: "failure-v1", synthesize: async () => { throw new Error("Injected TTS failure"); } };
  voiceId = "voice.failure-fixture";
} else if (env.AITUBER_TTS_PROVIDER === "irodori") {
  voiceId = "teacher";
  speechProvider = new CachedSpeechProvider(new BudgetedSpeechProvider({ backing: new IrodoriTtsProvider({
    ...(env.AITUBER_IRODORI_ENDPOINT ? { endpoint: env.AITUBER_IRODORI_ENDPOINT } : {}),
    ...(env.AITUBER_IRODORI_VOICE_REVISION ? { voiceRevision: env.AITUBER_IRODORI_VOICE_REVISION } : {}),
  }), budget: resourceBudgetStore, scope: "runtime", usdPerMillionCharacters: 0 }), ttsCachePath);
} else if (fishApiKey && fishVoiceId) {
  const model = env.AITUBER_FISH_AUDIO_MODEL ?? "s2.1-pro-free";
  const price = model === "s2.1-pro-free" ? 0 : optionalNonNegativeNumber(env.AITUBER_TTS_USD_PER_MILLION_CHARACTERS, "AITUBER_TTS_USD_PER_MILLION_CHARACTERS");
  speechProvider = new CachedSpeechProvider(new BudgetedSpeechProvider({ backing: new FishAudioTtsProvider({ apiKey: fishApiKey, model }), budget: resourceBudgetStore, scope: "runtime", ...(price !== undefined ? { usdPerMillionCharacters: price } : {}) }), ttsCachePath);
}
const llmSettings = new LlmSettingsStore(llmSettingsPath, env, resourceBudgetStore);
const lecture = new FixedLectureService({ store, playbackUnitMs, ...(speechProvider ? { speechProvider, voiceId } : {}), ...(ttsTestMode ? {} : { planner: createLessonPlanner(() => { try { return llmSettings.createProvider("runtime"); } catch { return null; } }) }) });
const authoring = new CourseAuthoringService({ directory: authoringPath, llm: () => llmSettings.createProvider("authoring"), onAvailable: (course) => lecture.registerCourse(course), defer: schedule });
authoring.list().forEach((job) => { if (job.course) lecture.registerCourse(job.course); });
let pedagogy: PedagogyService | null = null;
const questions = new QuestionQueueService({ classifier: createCommentClassifier(() => { try { return llmSettings.createProvider("runtime"); } catch { return null; } }), store: questionStore, context: (sessionId) => ({ session: lecture.getSession(sessionId), remainingMs: lecture.getRemainingTimeMs(sessionId) }), onQuestion: (input) => pedagogy?.recordQuestion(input) });
pedagogy = new PedagogyService({ store: evidenceStore, lecture, questions });
const supplements = new LiveSupplementService({ store: supplementStore, questions, lecture, llm: () => { try { return llmSettings.createProvider("runtime"); } catch { return null; } } });
const afterClass = new AfterClassService({ store: afterClassStore, questions, lecture, llm: () => { try { return llmSettings.createProvider("runtime"); } catch { return null; } } });

return {lecture,settings:llmSettings,authoring,questions,pedagogy,afterClass,supplements,dataRetention};
}
function optionalNonNegativeNumber(value: string | undefined, name: string): number | undefined {
  if (!value?.trim()) return undefined; const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
}
function optionalNonNegativeInteger(value: string | undefined, name: string): number | undefined { const parsed = optionalNonNegativeNumber(value, name); if (parsed !== undefined && !Number.isSafeInteger(parsed)) throw new Error(`${name} must be a non-negative integer`); return parsed; }
