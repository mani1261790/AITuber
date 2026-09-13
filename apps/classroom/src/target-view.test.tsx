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
});
