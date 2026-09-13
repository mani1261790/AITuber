import type { MascotPresentation } from "@aituber/presentation";

export function MascotView({ presentation }: { presentation: MascotPresentation }) {
  return (
    <figure
      className={`mascot mascot--${presentation.state}${presentation.mouthOpen ? " mascot--mouth-open" : ""}`}
      data-mascot-state={presentation.state}
      data-mouth={presentation.mouthOpen ? "open" : "closed"}
      data-target-id={presentation.targetId ?? undefined}
    >
      <div className="mascot-character" role="img" aria-label={presentation.announcement}>
        <span className="mascot-spark" aria-hidden="true">✦</span>
        <span className="mascot-antenna" aria-hidden="true" />
        <span className="mascot-head" aria-hidden="true">
          <span className="mascot-eye mascot-eye--left" />
          <span className="mascot-eye mascot-eye--right" />
          <span className="mascot-mouth" />
        </span>
        <span className="mascot-body" aria-hidden="true" />
        <span className="mascot-arm" aria-hidden="true" />
      </div>
      <figcaption>{presentation.announcement}</figcaption>
    </figure>
  );
}
