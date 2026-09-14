import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TargetView } from "./target-view.tsx";

describe("TargetView", () => {
  it("renders untrusted markup as inert text", () => {
    const markup = renderToStaticMarkup(
      <TargetView
        target={{
          id: "target.untrusted",
          sceneId: "scene.test",
          kind: "text",
          label: "教材本文",
          content: "<script>globalThis.compromised = true</script>",
          sourceIds: ["source.test"],
          visible: true,
          focused: false,
        }}
        onSelect={() => undefined}
      />,
    );
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;globalThis.compromised = true&lt;/script&gt;");
  });

  it("renders the quadratic graph as an accessible visual layer", () => {
    const markup = renderToStaticMarkup(<TargetView target={{ id: "target.math.complete-graph", sceneId: "scene.math.complete", kind: "diagram", label: "グラフで見る変化", content: "shift", sourceIds: ["source.test"], visible: true, focused: true }} onSelect={() => undefined} />);
    expect(markup).toContain("<svg");
    expect(markup).toContain("右へ2");
    expect(markup).toContain("下へ1");
    expect(markup).toContain('aria-label="yイコールx二乗を右へ2、下へ1移動するグラフ"');
  });
});
