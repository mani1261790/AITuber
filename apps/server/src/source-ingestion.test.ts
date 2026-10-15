import { describe, expect, it } from "vitest";
import { ingestSources } from "./source-ingestion.ts";

describe("ingestSources", () => {
  it("extracts Markdown and preserves its rights metadata", async () => {
    const result = await ingestSources([{ fileName: "lesson.md", mimeType: "text/markdown", dataBase64: Buffer.from("# 二次関数\n頂点を求める。多い").toString("base64"), rights: { basis: "owned", note: "講師作成" } }]);
    expect(result.sources[0]).toMatchObject({ kind: "markdown", fileName: "lesson.md", rights: { basis: "owned", note: "講師作成" } });
    expect(result.sources[0]?.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.text).toContain("二次関数");
  });

  it("extracts text from an uploaded PDF", async () => {
    const result = await ingestSources([{ fileName: "lesson.pdf", mimeType: "application/pdf", dataBase64: tinyPdf("Hello PDF lesson"), rights: { basis: "licensed" } }]);
    expect(result.sources[0]).toMatchObject({ kind: "pdf", fileName: "lesson.pdf" });
    expect(result.text).toContain("Hello PDF lesson");
  });

  it("preserves page boundaries and rotated dimensions for original-slide projection", async () => {
    const result = await ingestSources([{ fileName: "two.pdf", mimeType: "application/pdf", dataBase64: twoPagePdf(), rights: { basis: "owned" } }]);
    expect(result.sources[0]?.pageCount).toBe(2);
    expect(result.pages).toMatchObject([
      { pageNumber: 1, width: 300, height: 144, text: "First slide" },
      { pageNumber: 2, width: 144, height: 300, text: "Second slide" },
    ]);
    expect(result.pages?.every(page => page.sourceId === result.sources[0]?.id)).toBe(true);
    expect(result.text.indexOf("PAGE 1")).toBeLessThan(result.text.indexOf("First slide"));
    expect(result.text.indexOf("First slide")).toBeLessThan(result.text.indexOf("PAGE 2"));
    expect(result.text.indexOf("PAGE 2")).toBeLessThan(result.text.indexOf("Second slide"));
  });

  it("accepts scanned PDFs with complete page images and labels their page provenance", async () => {
    const dataBase64=Buffer.from([0xff,0xd8,0xff,0xd9]).toString("base64");
    const result=await ingestSources([{fileName:"scan.pdf",mimeType:"application/pdf",dataBase64:tinyPdf(""),rights:{basis:"owned"},pageImages:[{pageNumber:1,mimeType:"image/jpeg",dataBase64}]}]);
    expect(result.images).toEqual([{mimeType:"image/jpeg",dataBase64}]);
    expect(result.text).toContain(`IMAGE 1: SOURCE ${result.sources[0]!.id}, PAGE 1`);
    expect(result.pages?.[0]?.text).toBe("");
  });

  it("rejects missing, duplicate and mislabeled PDF page images", async () => {
    const image={pageNumber:1,mimeType:"image/jpeg" as const,dataBase64:Buffer.from([0xff,0xd8,0xff,0xd9]).toString("base64")};
    const upload={fileName:"two.pdf",mimeType:"application/pdf" as const,dataBase64:twoPagePdf(),rights:{basis:"owned" as const}};
    await expect(ingestSources([{...upload,pageImages:[image]}])).rejects.toThrow("Every PDF page");
    await expect(ingestSources([{...upload,pageImages:[image,image]}])).rejects.toThrow("duplicate");
    await expect(ingestSources([{...upload,pageImages:[image,{...image,pageNumber:2,dataBase64:"YQ=="}]}])).rejects.toThrow("declared MIME");
  });

  it("loads bundled CMaps when extracting Japanese PDF text", async () => {
    const result = await ingestSources([{ fileName: "japanese.pdf", mimeType: "application/pdf", dataBase64: japanesePdf("二次関数"), rights: { basis: "owned" } }]);
    expect(result.text).toContain("二次関数");
  });

  it("keeps an image for the LLM vision request", async () => {
    const base64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
    const result = await ingestSources([{ fileName: "diagram.png", mimeType: "image/png", dataBase64: base64, rights: { basis: "permission" } }]);
    expect(result.sources[0]?.kind).toBe("image");
    expect(result.images).toEqual([{ mimeType: "image/png", dataBase64: base64 }]);
    expect(result.text).toContain("Cite this source id");
  });

  it("rejects malformed and empty source payloads", async () => {
    await expect(ingestSources([{ fileName: "bad.md", mimeType: "text/markdown", dataBase64: "%%%", rights: { basis: "owned" } }])).rejects.toThrow("base64");
    await expect(ingestSources([])).rejects.toThrow("1-16");
  });

  it("rejects runtime MIME, rights, and file-name values outside the contract", async () => {
    const base = { fileName: "note.md", mimeType: "text/markdown", dataBase64: "YQ==", rights: { basis: "owned" } } as const;
    await expect(ingestSources([{ ...base, mimeType: "text/html" } as never])).rejects.toThrow("MIME");
    await expect(ingestSources([{ ...base, rights: { basis: "unknown" } } as never])).rejects.toThrow("rights");
    await expect(ingestSources([{ ...base, fileName: "bad\nname.md" }])).rejects.toThrow("file name");
    await expect(ingestSources([{ ...base, fileName: "../note.md" }])).rejects.toThrow("file name");
    await expect(ingestSources([{ ...base, fileName: ".." }])).rejects.toThrow("file name");
    await expect(ingestSources([{ ...base, fileName: "image.png", mimeType: "image/png" }])).rejects.toThrow("declared MIME");
  });
});

function tinyPdf(text: string): string {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length + 30} >>\nstream\nBT /F1 12 Tf 20 100 Td (${text}) Tj ET\nendstream`,
  ];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}

function japanesePdf(text: string): string {
  const textHex = Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase();
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UTF16-H /DescendantFonts [5 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 5 >> >>",
    `<< /Length ${textHex.length + 35} >>\nstream\nBT /F1 12 Tf 20 100 Td <${textHex}> Tj ET\nendstream`,
  ];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}

function twoPagePdf(): string {
  const stream = (text: string) => {
    const body = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
    return `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  };
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream("First slide"),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Rotate 90 /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>",
    stream("Second slide"),
  ];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}
