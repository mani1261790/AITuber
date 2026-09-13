import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CachedSpeechProvider, createSpeechCacheKey, FishAudioTtsProvider, TestToneSpeechProvider, type SpeechArtifact, type SpeechRequest, type TextToSpeechProvider } from "./speech.ts";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

const request: SpeechRequest = { text: "頂点は x イコール2です。", language: "ja-JP", voiceId: "voice.standard", dictionaryVersion: "dict.v1" };

describe("speech cache", () => {
  it("includes every synthesis input in the key", () => {
    const base = { provider: "fish-audio", model: "s2.1-pro-free", ...request };
    const original = createSpeechCacheKey(base);
    for (const changed of [
      { ...base, provider: "other" }, { ...base, model: "s1" }, { ...base, voiceId: "voice.other" },
      { ...base, dictionaryVersion: "dict.v2" }, { ...base, language: "en-US" }, { ...base, text: "別の文章" },
    ]) expect(createSpeechCacheKey(changed)).not.toBe(original);
  });

  it("persists an artifact and avoids a second provider call", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aituber-speech-")); directories.push(directory);
    const key = createSpeechCacheKey({ provider: "fake", model: "fixed", ...request });
    const artifact: SpeechArtifact = { cacheKey: key, provider: "fake", model: "fixed", voiceId: request.voiceId, mimeType: "audio/ogg", audio: Uint8Array.from([1, 2, 3]), segments: [{ text: request.text, startMs: 0, endMs: 500 }], durationMs: 500, firstAudioMs: 25, synthesisMs: 40 };
    const backing: TextToSpeechProvider = { provider: "fake", model: "fixed", synthesize: vi.fn(async () => artifact) };
    const cached = new CachedSpeechProvider(backing, directory);

    await cached.synthesize(request, { signal: new AbortController().signal });
    const second = await cached.synthesize(request, { signal: new AbortController().signal });

    expect(backing.synthesize).toHaveBeenCalledTimes(1);
    expect([...second.audio]).toEqual([1, 2, 3]);
    expect(await readFile(join(directory, `${key}.audio`))).toEqual(Buffer.from([1, 2, 3]));
  });
});

describe("FishAudioTtsProvider", () => {
  it("parses streamed audio and replaces cumulative timestamp snapshots", async () => {
    const events = [
      { audio_base64: Buffer.from([1]).toString("base64"), content: "頂点は", chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: { audio_duration: 0.2, segments: [{ text: "頂点", start: 0, end: 0.2 }] } },
      { audio_base64: Buffer.from([2]).toString("base64"), content: "頂点は", chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: { audio_duration: 0.5, segments: [{ text: "頂点", start: 0, end: 0.2 }, { text: "は", start: 0.2, end: 0.5 }] } },
      { audio_base64: Buffer.from([3]).toString("base64"), content: "二です", chunk_seq: 1, chunk_audio_offset_sec: 0.5, alignment: { audio_duration: 0.4, segments: [{ text: "二", start: 0, end: 0.2 }, { text: "です", start: 0.2, end: 0.4 }] } },
    ];
    let captured: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      captured = init;
      const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const provider = new FishAudioTtsProvider({ apiKey: "secret", fetch: fetchMock });
    const controller = new AbortController();

    const result = await provider.synthesize(request, { signal: controller.signal });

    expect([...result.audio]).toEqual([1, 2, 3]);
    expect(result.segments).toEqual([
      { text: "頂点", startMs: 0, endMs: 200 }, { text: "は", startMs: 200, endMs: 500 },
      { text: "二", startMs: 500, endMs: 700 }, { text: "です", startMs: 700, endMs: 900 },
    ]);
    expect(result.durationMs).toBe(900);
    expect(result.synthesisMs).toBeGreaterThanOrEqual(result.firstAudioMs);
    expect(captured?.signal).toBe(controller.signal);
    expect(captured?.headers).toMatchObject({ authorization: "Bearer secret", model: "s2.1-pro-free" });
    expect(JSON.parse(String(captured?.body))).toMatchObject({ format: "opus", sample_rate: 48_000 });
  });
});

describe("TestToneSpeechProvider", () => {
  it("creates a valid bounded WAV fixture with a matching timeline", async () => {
    const result = await new TestToneSpeechProvider(250).synthesize(request, { signal: new AbortController().signal });
    expect(new TextDecoder().decode(result.audio.slice(0, 4))).toBe("RIFF");
    expect(result.mimeType).toBe("audio/wav");
    expect(result.durationMs).toBe(250);
    expect(result.synthesisMs).toBe(0);
    expect(result.segments).toEqual([{ text: request.text, startMs: 0, endMs: 250 }]);
  });
});
