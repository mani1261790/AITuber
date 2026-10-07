import { describe, expect, it, vi } from "vitest";
import { IrodoriTtsProvider, wavDurationMs } from "./irodori-speech.ts";

function wav() {
  const b = Buffer.alloc(44 + 96000); b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(96000, 40); return b;
}
describe("Irodori local speech", () => {
  it("uses PCM duration for playback and separates voice revision caches", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(wav(), { headers: { "content-type": "audio/wav" } }));
    const request = { text: "平方完成です。", language: "ja-JP", voiceId: "teacher", dictionaryVersion: "1" };
    const a = await new IrodoriTtsProvider({ fetch: fetcher }).synthesize(request, { signal: new AbortController().signal });
    const b = await new IrodoriTtsProvider({ fetch: fetcher, voiceRevision: "new-reference" }).synthesize(request, { signal: new AbortController().signal });
    expect(a.durationMs).toBe(1000); expect(a.segments).toEqual([{ text: request.text, startMs: 0, endMs: 1000 }]); expect(a.cacheKey).not.toBe(b.cacheKey);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({ input: request.text, voice: "teacher", response_format: "wav" });
  });
  it("rejects truncated WAVs and service failures instead of playing invalid audio", async () => {
    expect(() => wavDurationMs(wav().subarray(0, 100))).toThrow("Truncated");
    const provider = new IrodoriTtsProvider({ fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("busy", { status: 503 })) });
    await expect(provider.synthesize({ text: "説明", language: "ja", voiceId: "teacher", dictionaryVersion: "1" }, { signal: new AbortController().signal })).rejects.toThrow("503");
  });
});
