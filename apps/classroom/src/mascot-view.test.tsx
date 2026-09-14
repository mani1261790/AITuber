import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MascotView } from "./mascot-view.tsx";

describe("MascotView", () => {
  it("exposes pose, mouth, target, and an accessible announcement", () => {
    const markup = renderToStaticMarkup(<MascotView presentation={{ state: "pointing", mouthOpen: true, targetId: "target.math.vertex", announcement: "頂点を案内しています" }} />);
    expect(markup).toContain('data-mascot-state="pointing"');
    expect(markup).toContain('data-mouth="open"');
    expect(markup).toContain('data-target-id="target.math.vertex"');
    expect(markup).toContain('aria-label="頂点を案内しています"');
    expect(markup).toContain('data-avatar-engine="vrm-3d"');
    expect(markup).toContain("AvatarSample_C · VRoid Project");
    expect(markup).not.toContain("<img");
  });
});
