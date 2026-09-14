import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "./rich-text.tsx";

describe("assessment math", () => {
  it("renders legacy plain equations alongside Japanese instructions", () => {
    const html = renderToStaticMarkup(<RichText text="y = (x + 3)^2 - 4 の頂点を答えてください。" />);
    expect(html).toContain('data-formula-state="rendered"');
    expect(html).toContain("の頂点を答えてください。");
    expect(html).not.toContain('data-formula-state="invalid"');
  });
  it("renders delimited TeX and escapes markup in surrounding text", () => {
    const html = renderToStaticMarkup(<RichText text={'<script> $\\frac{1}{2}$ と \\(x^2\\)'} />);
    expect(html.match(/data-formula-state="rendered"/g)).toHaveLength(2);
    expect(html).not.toContain("<script>");
  });
});
