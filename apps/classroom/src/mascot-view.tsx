import { lazy, Suspense } from "react";
import type { MascotPresentation } from "@aituber/presentation";

const VrmAvatar = lazy(async () => ({ default: (await import("./vrm-avatar.tsx")).VrmAvatar }));

export function MascotView({ presentation }: { presentation: MascotPresentation }) {
  return (
    <figure
      className={`mascot mascot--${presentation.state}${presentation.mouthOpen ? " mascot--mouth-open" : ""}`}
      data-mascot-state={presentation.state}
      data-mouth={presentation.mouthOpen ? "open" : "closed"}
      data-target-id={presentation.targetId ?? undefined}
    >
      <div className="mascot-character" role="img" aria-label={presentation.announcement} data-avatar-engine="vrm-3d">
        <span className="mascot-aura" aria-hidden="true" />
        <Suspense fallback={<span className="avatar-loading" aria-hidden="true" />}><VrmAvatar state={presentation.state} mouthOpen={presentation.mouthOpen} /></Suspense>
        <span className="mascot-spark" aria-hidden="true" />
      </div>
      <figcaption><span>{presentation.announcement}</span><small>AvatarSample_C · VRoid Project</small></figcaption>
    </figure>
  );
}
