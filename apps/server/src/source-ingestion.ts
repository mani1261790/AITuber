import { createHash } from "node:crypto";
import type { AuthoringSourceUpload, CoursePackage } from "@aituber/contracts";
import { extractText, getDocumentProxy } from "unpdf";

type SourceMaterial = CoursePackage["sources"][number];
export interface IngestedSources {
  readonly sources: readonly SourceMaterial[];
  readonly text: string;
  readonly images: readonly { readonly mimeType: "image/png" | "image/jpeg" | "image/webp"; readonly dataBase64: string }[];
}

export async function ingestSources(uploads: readonly AuthoringSourceUpload[]): Promise<IngestedSources> {
  if (uploads.length < 1 || uploads.length > 16) throw new TypeError("1-16 source files are required");
  const sources: SourceMaterial[] = []; const texts: string[] = []; const images: IngestedSources["images"][number][] = []; let totalBytes = 0;
  for (const [index, upload] of uploads.entries()) {
    if (!allowedMimeTypes.has(upload.mimeType)) throw new TypeError(`source ${index + 1} has an unsupported MIME type`);
    if (!allowedRights.has(upload.rights?.basis)) throw new TypeError(`source ${index + 1} has invalid rights metadata`);
    if (upload.rights.note !== undefined && (typeof upload.rights.note !== "string" || upload.rights.note.length > 1_000)) throw new TypeError(`source ${index + 1} has invalid rights notes`);
    const bytes = decodeBase64(upload.dataBase64);
    const maximumBytes = upload.mimeType.startsWith("image/") ? 10 * 1024 * 1024 : 20 * 1024 * 1024;
    if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) throw new TypeError(`source ${index + 1} exceeds its size limit`);
    totalBytes += bytes.byteLength; if (totalBytes > 24 * 1024 * 1024) throw new TypeError("combined source files exceed 24 MiB");
    assertFileSignature(upload.mimeType, bytes, index + 1);
    const fileName = boundedFileName(upload.fileName);
    const id = `source.${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}`;
    const kind = upload.mimeType === "application/pdf" ? "pdf" : upload.mimeType.startsWith("image/") ? "image" : upload.mimeType === "text/markdown" ? "markdown" : "instructor-note";
    sources.push({ id, kind, fileName, contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, rights: upload.rights });
    if (upload.mimeType === "application/pdf") {
      const document = await getDocumentProxy(bytes);
      try {
        if (!Number.isSafeInteger(document.numPages) || document.numPages < 1 || document.numPages > 500) throw new TypeError(`source ${index + 1} exceeds the 500-page PDF limit`);
        const extracted = await extractText(document, { mergePages: true });
        const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
        texts.push(`SOURCE ${id} (${fileName}, ${document.numPages} pages)\n${boundedExtractedText(text)}`);
      } finally { await document.cleanup(); }
    } else if (upload.mimeType.startsWith("image/")) {
      images.push({ mimeType: upload.mimeType, dataBase64: upload.dataBase64 } as IngestedSources["images"][number]);
      texts.push(`SOURCE ${id} (${fileName}, image). Cite this source id for content derived from the image.`);
    } else {
      texts.push(`SOURCE ${id} (${fileName})\n${boundedExtractedText(new TextDecoder("utf-8", { fatal: true }).decode(bytes))}`);
    }
  }
  const text = texts.join("\n\n");
  if (new TextEncoder().encode(text).byteLength > 400_000) throw new TypeError("combined extracted source text exceeds 400000 bytes");
  return { sources, text, images };
}

const allowedMimeTypes = new Set<AuthoringSourceUpload["mimeType"]>(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/markdown", "text/plain"]);
const allowedRights = new Set<AuthoringSourceUpload["rights"]["basis"]>(["owned", "licensed", "public-domain", "permission"]);
function decodeBase64(value: string): Uint8Array { if (typeof value !== "string" || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError("source data must be base64"); return Uint8Array.from(Buffer.from(value, "base64")); }
function boundedFileName(value: string): string { const name = typeof value === "string" ? value.trim().normalize("NFKC") : ""; const hasControl = [...name].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127); if (!name || name === "." || name === ".." || name.length > 255 || name.includes("/") || name.includes("\\") || hasControl) throw new TypeError("invalid source file name"); return name; }
function boundedExtractedText(value: string): string { const text = value.trim(); if (!text) throw new TypeError("source did not contain extractable text"); if (new TextEncoder().encode(text).byteLength > 350_000) throw new TypeError("extracted source text exceeds 350000 bytes"); return text; }
function assertFileSignature(mimeType: AuthoringSourceUpload["mimeType"], bytes: Uint8Array, index: number) {
  const ascii = (start: number, length: number) => new TextDecoder("ascii").decode(bytes.slice(start, start + length));
  const valid = mimeType === "application/pdf" ? ascii(0, 5) === "%PDF-"
    : mimeType === "image/png" ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, offset) => bytes[offset] === value)
      : mimeType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : mimeType === "image/webp" ? ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP"
          : true;
  if (!valid) throw new TypeError(`source ${index} content does not match its declared MIME type`);
}
