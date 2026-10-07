import { createSpeechCacheKey, type SpeechArtifact, type SpeechRequest, type TextToSpeechProvider } from "./speech.ts";

export const IRODORI_ANIME_MODEL = "phasefield-audio/Irodori-TTS-v4.1-Anime";

/** Duration comes from PCM samples, never from estimated Japanese reading speed. */
export function wavDurationMs(audio: Uint8Array): number {
  const bytes = Buffer.from(audio);
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("Invalid WAV response");
  let byteRate = 0; let dataSize = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4); const start = offset + 8;
    if (start + size > bytes.length) throw new Error("Truncated WAV response");
    const id = bytes.toString("ascii", offset, offset + 4);
    if (id === "fmt ") {
      if (size < 16 || bytes.readUInt16LE(start) !== 1) throw new Error("Expected PCM WAV");
      byteRate = bytes.readUInt32LE(start + 8);
    }
    if (id === "data") dataSize += size;
    offset = start + size + (size % 2);
  }
  if (!byteRate || !dataSize) throw new Error("Empty WAV response");
  return Math.ceil(dataSize / byteRate * 1000);
}

export class IrodoriTtsProvider implements TextToSpeechProvider {
  readonly provider = "irodori-local";
  readonly model: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  constructor(options: { endpoint?: string; voiceRevision?: string; fetch?: typeof fetch } = {}) {
    this.#endpoint = options.endpoint ?? "http://127.0.0.1:4313/v1/audio/speech";
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    // Caption, reference audio or sampler changes need a new revision to invalidate cache.
    this.model = `${IRODORI_ANIME_MODEL}:${options.voiceRevision ?? "teacher-v1"}`;
  }
  async synthesize(request: SpeechRequest, options: { signal: AbortSignal }): Promise<SpeechArtifact> {
    if (!request.text.trim() || request.text.length > 600) throw new Error("Irodori speech must contain 1 to 600 characters");
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(180_000)]);
    const start = performance.now();
    const response = await this.#fetch(this.#endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: IRODORI_ANIME_MODEL, input: request.text, voice: request.voiceId, response_format: "wav" }), signal });
    if (!response.ok || !response.body) throw new Error(`Irodori TTS failed with HTTP ${response.status}`);
    if (!response.headers.get("content-type")?.startsWith("audio/wav")) throw new Error("Expected WAV audio from Irodori");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) { const item = await reader.read(); if (item.done) break; length += item.value.length; if (length > 32_000_000) throw new Error("Irodori audio exceeds size limit"); chunks.push(item.value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    signal.throwIfAborted();
    const audio = Buffer.concat(chunks); const durationMs = wavDurationMs(audio); const elapsed = performance.now() - start;
    return { cacheKey: createSpeechCacheKey({ ...request, provider: this.provider, model: this.model }), provider: this.provider, model: this.model, voiceId: request.voiceId,
      audio, mimeType: "audio/wav", durationMs, firstAudioMs: elapsed, synthesisMs: elapsed,
      // Irodori has no word alignments: expose an honest utterance-wide subtitle.
      segments: [{ text: request.text, startMs: 0, endMs: durationMs }] };
  }
}
