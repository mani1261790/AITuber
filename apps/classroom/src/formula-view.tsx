import { renderToString } from "katex";

const katexOptions = {
  displayMode: true,
  output: "htmlAndMathml" as const,
  throwOnError: true,
  trust: false,
  strict: "error" as const,
  maxExpand: 100,
  maxSize: 10,
};

export function FormulaView({ tex }: { tex: string }) {
  try {
    const markup = renderToString(tex, katexOptions);
    return <span className="formula" data-formula-state="rendered" dangerouslySetInnerHTML={{ __html: markup }} />;
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "ParseError") throw error;
    return (
      <span className="formula formula--invalid" data-formula-state="invalid">
        <code>{tex}</code>
        <small>数式を表示できません</small>
      </span>
    );
  }
}
