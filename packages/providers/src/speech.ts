import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const FISH_STANDARD_VOICE_ID = "b2d9d8db057042688a5e318b8f405bc2";

export interface SpeechRequest {
  readonly text: string;
  readonly language: string;
  readonly voiceId: string;
  readonly dictionaryVersion: string;
}

export interface SpeechAlignmentSegment {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface SpeechArtifact {
  readonly cacheKey: string;
  readonly provider: string;
  readonly model: string;
  readonly voiceId: string;
  readonly mimeType: string;
  readonly audio: Uint8Array;
  readonly segments: readonly SpeechAlignmentSegment[];
  readonly durationMs: number;
  readonly firstAudioMs: number;
}

export interface TextToSpeechProvider {
  readonly provider: string;
  readonly model: string;
  synthesize(request: SpeechRequest, options: { signal: AbortSignal }): Promise<SpeechArtifact>;
}

export function createSpeechCacheKey(input: {
  provider: string; model: string; voiceId: string; dictionaryVersion: string; language: string; text: string;
}): string {
  return createHash("sha256").update(JSON.stringify([
    input.provider, input.model, input.voiceId, input.dictionaryVersion, input.language, input.text,
  ])).digest("hex");
}

export class CachedSpeechProvider implements TextToSpeechProvider {
  readonly provider: string;
  readonly model: string;
  readonly #backing: TextToSpeechProvider;
  readonly #directory: string;

  constructor(backing: TextToSpeechProvider, directory: string) {
    this.#backing = backing;
    this.#directory = directory;
    this.provider = backing.provider;
    this.model = backing.model;
  }

  async synthesize(request: SpeechRequest, options: { signal: AbortSignal }): Promise<SpeechArtifact> {
    const key = createSpeechCacheKey({ provider: this.provider, model: this.model, voiceId: request.voiceId, dictionaryVersion: request.dictionaryVersion, language: request.language, text: request.text });
    const cached = await this.#read(key);
    if (cached) return cached;
    const artifact = await this.#backing.synthesize(request, options);
    if (artifact.cacheKey !== key) throw new TypeError("Speech provider returned an unexpected cache key");
    if (options.signal.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    await mkdir(this.#directory, { recursive: true });
    await Promise.all([
      writeFile(join(this.#directory, `${key}.audio`), artifact.audio),
      writeFile(join(this.#directory, `${key}.json`), JSON.stringify({ ...artifact, audio: undefined })),
    ]);
    return artifact;
  }

  async #read(key: string): Promise<SpeechArtifact | null> {
    try {
      const [metadata, audio] = await Promise.all([
        readFile(join(this.#directory, `${key}.json`), "utf8"),
        readFile(join(this.#directory, `${key}.audio`)),
      ]);
      const parsed = JSON.parse(metadata) as Omit<SpeechArtifact, "audio">;
      return { ...parsed, audio };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

interface FishSseEvent {
  audio_base64: string;
  content: string;
  chunk_seq: number;
  chunk_audio_offset_sec: number;
  alignment: { audio_duration: number; segments: { text: string; start: number; end: number }[] } | null;
}

export class FishAudioTtsProvider implements TextToSpeechProvider {
  readonly provider = "fish-audio";
  readonly model: string;
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: { apiKey: string; model?: string; endpoint?: string; fetch?: typeof fetch }) {
    if (!options.apiKey) throw new TypeError("Fish Audio API key is required");
    this.#apiKey = options.apiKey;
    this.model = options.model ?? "s2-pro";
    this.#endpoint = options.endpoint ?? "https://api.fish.audio/v1/tts/stream/with-timestamp";
    this.#fetch = options.fetch ?? fetch;
  }

  async synthesize(request: SpeechRequest, options: { signal: AbortSignal }): Promise<SpeechArtifact> {
    if (!request.text.trim()) throw new TypeError("Speech text is required");
    const cacheKey = createSpeechCacheKey({ provider: this.provider, model: this.model, voiceId: request.voiceId, dictionaryVersion: request.dictionaryVersion, language: request.language, text: request.text });
    const requestedAt = performance.now();
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json", model: this.model },
      body: JSON.stringify({ text: request.text, reference_id: request.voiceId, format: "opus", sample_rate: 48_000, latency: "balanced", normalize: true, chunk_length: 300 }),
      signal: options.signal,
    });
    if (!response.ok || !response.body) throw new Error(`Fish Audio TTS failed with HTTP ${response.status}`);

    const audioChunks: Uint8Array[] = [];
    const alignments = new Map<number, FishSseEvent>();
    let firstAudioMs = -1;
    for await (const event of parseFishAudioSse(response.body)) {
      if (event.audio_base64) {
        if (firstAudioMs < 0) firstAudioMs = Math.max(0, performance.now() - requestedAt);
        audioChunks.push(Buffer.from(event.audio_base64, "base64"));
      }
      if (event.alignment) alignments.set(event.chunk_seq, event);
    }
    if (audioChunks.length === 0) throw new Error("Fish Audio returned no audio");
    const segments = [...alignments.values()].sort((a, b) => a.chunk_seq - b.chunk_seq).flatMap((event) =>
      event.alignment!.segments.map((segment) => ({
        text: segment.text,
        startMs: Math.round((event.chunk_audio_offset_sec + segment.start) * 1_000),
        endMs: Math.round((event.chunk_audio_offset_sec + segment.end) * 1_000),
      })),
    );
    const alignmentDuration = [...alignments.values()].reduce((total, event) => Math.max(total, event.chunk_audio_offset_sec + (event.alignment?.audio_duration ?? 0)), 0);
    const durationMs = segments.at(-1)?.endMs ?? Math.max(250, Math.round(alignmentDuration * 1_000));
    return { cacheKey, provider: this.provider, model: this.model, voiceId: request.voiceId, mimeType: "audio/ogg; codecs=opus", audio: concatBytes(audioChunks), segments, durationMs, firstAudioMs };
  }
}

export class TestToneSpeechProvider implements TextToSpeechProvider {
  readonly provider = "test-tone";
  readonly model = "sine-wave-v1";
  readonly durationMs: number;
  constructor(durationMs = 1_000) { this.durationMs = durationMs; }

  async synthesize(request: SpeechRequest, options: { signal: AbortSignal }): Promise<SpeechArtifact> {
    if (options.signal.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    const cacheKey = createSpeechCacheKey({ provider: this.provider, model: this.model, voiceId: request.voiceId, dictionaryVersion: request.dictionaryVersion, language: request.language, text: request.text });
    return {
      cacheKey, provider: this.provider, model: this.model, voiceId: request.voiceId, mimeType: "audio/wav",
      audio: createToneWav(this.durationMs), segments: [{ text: request.text, startMs: 0, endMs: this.durationMs }],
      durationMs: this.durationMs, firstAudioMs: 0,
    };
  }
}

export async function* parseFishAudioSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<FishSseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (data && data !== "[DONE]") yield validateFishEvent(JSON.parse(data) as unknown);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const data = buffer.trim().replace(/^data:\s*/, "");
      if (data && data !== "[DONE]") yield validateFishEvent(JSON.parse(data) as unknown);
    }
  } finally { reader.releaseLock(); }
}

function validateFishEvent(value: unknown): FishSseEvent {
  if (!value || typeof value !== "object") throw new TypeError("Invalid Fish Audio SSE event");
  const event = value as Partial<FishSseEvent>;
  if (typeof event.audio_base64 !== "string" || typeof event.content !== "string" || !Number.isInteger(event.chunk_seq) || typeof event.chunk_audio_offset_sec !== "number") throw new TypeError("Invalid Fish Audio SSE event");
  return event as FishSseEvent;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function createToneWav(durationMs: number): Uint8Array {
  const sampleRate = 16_000;
  const sampleCount = Math.round(sampleRate * durationMs / 1_000);
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, 36 + sampleCount * 2, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.min(1, index / 400, (sampleCount - index) / 400);
    view.setInt16(44 + index * 2, Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 2_500 * envelope), true);
  }
  return bytes;
}
