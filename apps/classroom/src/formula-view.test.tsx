import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormulaView } from "./formula-view.tsx";

describe("FormulaView", () => {
  it.each([
    ["二次関数", "y = a(x - h)^2 + k"],
    ["DNA複製", "5^\\prime \\to 3^\\prime"],
    ["VAE", "q_\\phi(z \\mid x) = \\mathcal{N}(0, I)"],
  ])("renders the %s fixture notation as visual HTML with accessible MathML", (_subject, tex) => {
    const markup = renderToStaticMarkup(<FormulaView tex={tex} />);
    expect(markup).toContain('data-formula-state="rendered"');
    expect(markup).toContain("<math");
    expect(markup).toContain("katex-html");
  });

  it("does not grant link or HTML commands trust", () => {
    const markup = renderToStaticMarkup(<FormulaView tex={"\\href{https://example.com}{x}"} />);
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("href=");
  });

  it("falls back to inert text when TeX is invalid", () => {
    const markup = renderToStaticMarkup(<FormulaView tex={"\\frac{"} />);
    expect(markup).toContain('data-formula-state="invalid"');
    expect(markup).toContain("数式を表示できません");
    expect(markup).toContain("\\frac{");
  });

  it("stops recursive macro expansion", () => {
    const markup = renderToStaticMarkup(<FormulaView tex={"\\def\\loop{\\loop}\\loop"} />);
    expect(markup).toContain('data-formula-state="invalid"');
  });
});
