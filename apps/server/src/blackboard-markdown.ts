import { createHash } from "node:crypto";
import { boardExamples, type BlackboardDrawing } from "@aituber/contracts";

export const boardMarkdownSchema = { type: ["string", "null"], maxLength: 700 };
export const boardMarkdownInstruction = "Slides are the default teaching surface. Return blackboardMarkdown=null when using slides. Never create a board merely to summarize, copy, reformat, or emphasize content already visible on the slide. A board is justified only by a necessary missing derivation, relationship, worked example, or a learner question that requires a visual explanation absent from the slide. If spoken explanation with the slide suffices, do not write. Examples below demonstrate notation ONLY, not a preference to use a board. For a helpful board note, write its complete contents in blackboardMarkdown in the SAME response as speech. Use Japanese classroom board notation: # heading, short newline-separated lines, **important words**, →, ◎, and TeX inside $...$ or $$...$$. Keep TeX blocks on one line. At most 8 nonempty lines, 700 characters total, 80 characters per line. No HTML, images, links, SVG, tables or code fences. Each non-null board replaces the previous board. Explain those notes in speech; do not read Markdown syntax aloud. Do not copy the whole slide or speech onto the board. " +
  " Flow diagrams: write one labeled transfer per line as sender → recipient：message. Name both endpoints on every line, including the final return. Use separate lines for different messages; never append another arrow after a message label (ambiguous: アプリ → LLM：結果 → 利用者：回答). An unlabeled actor chain such as A → B → C is allowed. Preserve any required intermediary rather than inventing a direct connection. Use up to eight lines instead of compressing distinct transfers. Layout: headings, equations and explanation lines are left-aligned from a stable top-left writing origin; equations and arrow lines receive a modest indent. Use two leading spaces for one indent level (at most two levels) and a blank line between conceptual groups. Do not align text with repeated spaces or emit CSS. Prefer 3 to 5 short lines, about 24 Japanese characters per text line; one main conclusion per board. Speech can accompany writing. Explain the reasoning in the same top-to-bottom order as the notes, as an explanation being developed together. Do not say unfinished text is already visible, point at a final result before introducing it, or announce that writing has finished. Examples show only the board/speech fields; preserve all other fields required by your output schema.\n" +
  boardExamples.map(example=>JSON.stringify({input:example.input,output:{blackboardMarkdown:example.blackboardMarkdown,text:example.text}})).join("\n") +
  "\nFor slide-only explanation: {\"blackboardMarkdown\":null,\"text\":\"スライドの式の、この部分を見てください。\"}\n";

export function markdownBoard(value: string | null | undefined): BlackboardDrawing | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error("板書は文字列で指定してください");
  const markdown=value.replace(/\r\n?/g,"\n").trim();
  const lines=markdown.split("\n").filter(line=>line.trim());
  if (!markdown || markdown.length>700 || lines.length>8 || lines.some(line=>line.length>80)) throw new Error("板書は8行以内・各行80文字以内・全体700文字以内にしてください");
  if (/<\/?[a-z][^>]*>|```|!\[|\]\(/i.test(markdown)) throw new Error("板書ではHTML・画像・リンク・コードを使用できません");
  if (lines.some(line => /[→←↔][^：:\n]*[：:][^→←↔\n]+[→←↔]/u.test(line.replace(/\$\$?[^$]*\$\$?/g,"")))) throw new Error("矢印図は1行に1つの受け渡しを記載し、各行に送り手・受け手・内容を明示してください。内容の後に別の矢印を続けず、次の行に送り手から書いてください");
  return {id:`blackboard.${createHash("sha256").update(markdown).digest("hex")}`,markdown,purpose:lines[0]!.replace(/^#+\s*/,"").slice(0,80)};
}
