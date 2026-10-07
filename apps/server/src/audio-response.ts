import type { IncomingMessage, ServerResponse } from "node:http";

/** Serve a complete artifact as seekable media, with a known length from metadata time. */
export function sendAudio(request: IncomingMessage, response: ServerResponse, audio: Uint8Array, mimeType: string) {
  const headers: Record<string, string> = { "content-type": mimeType, "cache-control": "no-store", "accept-ranges": "bytes" };
  let start = 0, end = audio.byteLength - 1, partial = false;
  // Unsupported/malformed multi-ranges and unvalidated If-Range fall back to the
  // complete representation. Single byte ranges cover browser media seeking.
  const range = !request.headers["if-range"] && /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    partial = true;
    if (!range[1]) {
      const suffix = Number(range[2]);
      start = Number.isSafeInteger(suffix) && suffix > 0 ? Math.max(0, audio.byteLength - suffix) : audio.byteLength;
    } else {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= audio.byteLength) {
      response.writeHead(416, { ...headers, "content-range": `bytes */${audio.byteLength}`, "content-length": "0" });
      response.end(); return;
    }
    headers["content-range"] = `bytes ${start}-${end}/${audio.byteLength}`;
  }
  headers["content-length"] = String(Math.max(0, end - start + 1));
  response.writeHead(partial ? 206 : 200, headers);
  response.end(request.method === "HEAD" ? undefined : audio.subarray(start, end + 1));
}
