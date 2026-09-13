import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quadraticFunctionsFixture, vaeReparameterizationFixture } from "@aituber/content";
import { createSpeechCacheKey, type SpeechArtifact, type TextToSpeechProvider } from "@aituber/providers";
import { LectureEventStore } from "@aituber/storage";
import { applyPronunciationDictionary, FixedLectureService } from "./fixed-lecture-service.ts";

describe("FixedLectureService", () => {
  let store: LectureEventStore;
  let service: FixedLectureService;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new LectureEventStore(":memory:");
    service = new FixedLectureService({ store, courses: [quadraticFunctionsFixture], playbackUnitMs: 100 });
  });

  afterEach(() => {
    service.close();
    store.close();
    vi.useRealTimers();
  });

  it("runs teaching units automatically, waits for the checkpoint, and completes after an answer", () => {
    const started = service.createSession({
      coursePackageId: quadraticFunctionsFixture.id,
      durationMinutes: quadraticFunctionsFixture.durationMinutes,
    });
    expect(started.status).toBe("TEACHING");
    expect(started.speech.playing).toBe(true);
    vi.advanceTimersByTime(500);

    const checkpoint = service.getSession(started.id);
    expect(checkpoint.status).toBe("CHECKPOINT");
    expect(checkpoint.progress).toEqual({ completed: 5, total: 6 });
    expect(checkpoint.assessment?.id).toBe("assessment.math.vertex");

    service.command(started.id, { command: "answer", answer: "(-3, -4)" });
    vi.advanceTimersByTime(100);

    const finished = service.getSession(started.id);
    expect(finished.status).toBe("FINISHED");
    expect(finished.completedUnitIds).toEqual(quadraticFunctionsFixture.schedule.orderedUnitIds);
    expect(finished.unfinishedUnitIds).toEqual([]);
    expect(store.loadEvents(started.id).some((event) => event.type === "assessment.answer-recorded")).toBe(true);
  });

  it("keeps the current unit unfinished while paused and resumes it in a new epoch", () => {
    const started = service.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    const paused = service.command(started.id, { command: "pause" });
    expect(paused.status).toBe("PAUSED");
    expect(paused.epoch).toBe(2);
    vi.advanceTimersByTime(1_000);
    expect(service.getSession(started.id).progress.completed).toBe(0);

    const resumed = service.command(started.id, { command: "resume" });
    expect(resumed.status).toBe("TEACHING");
    vi.advanceTimersByTime(100);
    expect(service.getSession(started.id).progress.completed).toBe(1);
    expect(store.loadEvents(started.id).map((event) => event.epoch)).toContain(2);
  });

  it("publishes monotonic snapshots with a reconnect-safe audio offset", () => {
    vi.setSystemTime(new Date("2026-09-14T00:00:00.000Z"));
    const observed: number[] = [];
    const unsubscribe = service.subscribe((_sessionId, snapshot) => observed.push(snapshot.seq));
    const started = service.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    const initial = service.getSnapshot(started.id);
    vi.advanceTimersByTime(40);
    const reconnect = service.getSnapshot(started.id);

    expect(reconnect.seq).toBe(initial.seq);
    expect(reconnect.audioOffsetMs).toBe(40);
    expect(observed.length).toBeGreaterThan(0);
    expect(observed).toEqual([...observed].sort((left, right) => left - right));
    unsubscribe();
  });

  it("reports completed and unfinished units when an operator ends early", () => {
    const started = service.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    vi.advanceTimersByTime(200);
    const finished = service.command(started.id, { command: "finish" });
    expect(finished.status).toBe("FINISHED");
    expect(finished.completedUnitIds).toEqual(quadraticFunctionsFixture.schedule.orderedUnitIds.slice(0, 2));
    expect(finished.unfinishedUnitIds).toEqual(quadraticFunctionsFixture.schedule.orderedUnitIds.slice(2));
  });

  it("uses timestamped provider audio and exposes the current artifact", async () => {
    service.close();
    const provider = fixedProvider();
    service = new FixedLectureService({ store, courses: [quadraticFunctionsFixture], playbackUnitMs: 100, speechProvider: provider, voiceId: "voice.standard" });
    const started = service.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    expect(started.speech.mode).toBe("preparing");
    await vi.waitFor(() => expect(service.getSession(started.id).speech.mode).toBe("fish-audio"));

    const speaking = service.getSession(started.id);
    expect(speaking.speech.segments[0]?.semanticTargetIds).toEqual(["target.math.vertex-form"]);
    const cacheKey = speaking.speech.audioUrl!.split("/").at(-1)!.split("?")[0]!;
    expect([...service.getSpeechAudio(started.id, speaking.epoch, cacheKey).audio]).toEqual([1, 2, 3]);
    service.command(started.id, { command: "pause" });
    expect(() => service.getSpeechAudio(started.id, speaking.epoch, cacheKey)).toThrow("no longer active");
    service.command(started.id, { command: "resume" });
    await vi.waitFor(() => expect(service.getSession(started.id).speech.mode).toBe("fish-audio"));
    vi.advanceTimersByTime(300);
    expect(service.getSession(started.id).progress.completed).toBe(1);
  });

  it("discards a provider result after pause changes the epoch", async () => {
    service.close();
    let resolveSpeech!: (artifact: SpeechArtifact) => void;
    const provider: TextToSpeechProvider = { provider: "fake", model: "fixed", synthesize: () => new Promise((resolve) => { resolveSpeech = resolve; }) };
    service = new FixedLectureService({ store, courses: [quadraticFunctionsFixture], playbackUnitMs: 100, speechProvider: provider, voiceId: "voice.standard" });
    const started = service.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    service.command(started.id, { command: "pause" });
    resolveSpeech(makeArtifact(quadraticFunctionsFixture.teachingUnits[0]!.speechText));
    await Promise.resolve();
    vi.advanceTimersByTime(1_000);

    const paused = service.getSession(started.id);
    expect(paused.status).toBe("PAUSED");
    expect(paused.progress.completed).toBe(0);
    expect(paused.speech.audioUrl).toBeNull();
  });

  it("continues with captions after a TTS failure", async () => {
    service.close();
    const provider: TextToSpeechProvider = { provider: "fake", model: "fixed", synthesize: async () => { throw new Error("injected failure"); } };
    service = new FixedLectureService({ store, courses: [quadraticFunctionsFixture], playbackUnitMs: 100, speechProvider: provider, voiceId: "voice.standard" });
    const started = service.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    await vi.waitFor(() => expect(service.getSession(started.id).speech.mode).toBe("caption-fallback"));
    expect(service.getSession(started.id).speech.failure).toBe("injected failure");
    vi.advanceTimersByTime(quadraticFunctionsFixture.teachingUnits[0]!.estimatedDurationMs);
    expect(service.getSession(started.id).progress.completed).toBe(1);
  });

  it("registers only reviewed available Course Packages for lecture use", () => {
    expect(service.listCourses().some((course) => course.id === vaeReparameterizationFixture.id)).toBe(false);
    service.registerCourse(vaeReparameterizationFixture);
    expect(service.listCourses().some((course) => course.id === vaeReparameterizationFixture.id)).toBe(true);
    expect(service.createSession({ coursePackageId: vaeReparameterizationFixture.id, durationMinutes: 8 }).course.id).toBe(vaeReparameterizationFixture.id);
    expect(() => service.registerCourse({ ...vaeReparameterizationFixture, status: "reviewing" })).toThrow("Only an available");
  });
});

describe("pronunciation dictionary", () => {
  it("applies longer entries first to the finalized speech and subtitle text", () => {
    expect(applyPronunciationDictionary("DNAポリメラーゼとDNA", [
      { surface: "DNA", reading: "ディーエヌエー" },
      { surface: "DNAポリメラーゼ", reading: "ディーエヌエーポリメラーゼ" },
    ])).toBe("ディーエヌエーポリメラーゼとディーエヌエー");
  });

  it("finalizes VAE symbols into unambiguous Japanese readings", () => {
    const transform = vaeReparameterizationFixture.teachingUnits.find((unit) => unit.id === "unit.vae.transform")!;
    expect(applyPronunciationDictionary(transform.speechText, vaeReparameterizationFixture.pronunciationDictionary))
      .toBe("ゼットはミューたすシグマかけるイプシロンと計算します。ミューとシグマが分布の位置と広がりを決め、イプシロンが今回の揺らぎを決めます。");
  });
});

function fixedProvider(): TextToSpeechProvider {
  return { provider: "fake", model: "fixed", synthesize: async (request) => makeArtifact(request.text) };
}

function makeArtifact(text: string): SpeechArtifact {
  return {
    cacheKey: createSpeechCacheKey({ provider: "fake", model: "fixed", voiceId: "voice.standard", dictionaryVersion: `sha256:${"0".repeat(64)}`, language: "ja-JP", text }),
    provider: "fake", model: "fixed", voiceId: "voice.standard", mimeType: "audio/ogg", audio: Uint8Array.from([1, 2, 3]),
    segments: [{ text, startMs: 0, endMs: 300 }], durationMs: 300, firstAudioMs: 20, synthesisMs: 35,
  };
}
