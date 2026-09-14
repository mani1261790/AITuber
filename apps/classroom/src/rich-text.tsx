import { FormulaView } from "./formula-view.tsx";

/** Accept explicit TeX delimiters and the plain equations used by legacy lessons. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|[A-Za-z]\s*=\s*[A-Za-z0-9\s+\-−*/^().,{}=]+)/g);
  return <span className="rich-text">{parts.map((part, index) => {
    const math = part.startsWith("$") || part.startsWith("\\(") || part.startsWith("\\[") || /^[A-Za-z]\s*=/.test(part);
    return math ? <FormulaView key={index} tex={part.replace(/^\$\$?|\$\$?$/g, "").replace(/^\\[([]|\\[)\]]$/g, "").trim()} /> : <span key={index}>{part}</span>;
  })}</span>;
}
