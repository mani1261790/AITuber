import { createHash } from "node:crypto";
import type { BlackboardDrawing } from "@aituber/contracts";

export const boardMarkdownSchema = { type: ["string", "null"], maxLength: 700 };
export const boardMarkdownInstruction = "Return blackboardMarkdown=null when using slides. For a helpful board note, write its complete contents in blackboardMarkdown in the SAME response as speech. Use Japanese classroom board notation: # heading, short newline-separated lines, **important words**, →, ◎, and TeX inside $...$ or $$...$$. Keep TeX blocks on one line. At most 8 nonempty lines, 700 characters total, 80 characters per line. No HTML, images, links, SVG, tables or code fences. Each non-null board replaces the previous board. Explain those notes in speech; do not read Markdown syntax aloud. Do not copy the whole slide or speech onto the board. ";
export function markdownBoard(value: string | null | undefined): BlackboardDrawing | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error("板書は文字列で指定してください");
  const markdown=value.replace(/\r\n?/g,"\n").trim();
  const lines=markdown.split("\n").filter(line=>line.trim());
  if (!markdown || markdown.length>700 || lines.length>8 || lines.some(line=>line.length>80)) throw new Error("板書は8行以内・各行80文字以内・全体700文字以内にしてください");
  if (/<\/?[a-z][^>]*>|```|!\[|\]\(/i.test(markdown)) throw new Error("板書ではHTML・画像・リンク・コードを使用できません");
  return {id:`blackboard.${createHash("sha256").update(markdown).digest("hex")}`,markdown,purpose:lines[0]!.replace(/^#+\s*/,"").slice(0,80)};
}
