import type { MascotPresentation } from "@aituber/presentation";
import astralTutor from "./assets/astral-tutor.webp";

export function MascotView({ presentation }: { presentation: MascotPresentation }) {
  return (
    <figure
      className={`mascot mascot--${presentation.state}${presentation.mouthOpen ? " mascot--mouth-open" : ""}`}
      data-mascot-state={presentation.state}
      data-mouth={presentation.mouthOpen ? "open" : "closed"}
      data-target-id={presentation.targetId ?? undefined}
    >
      <div className="mascot-character" role="img" aria-label={presentation.announcement}>
        <span className="mascot-aura" aria-hidden="true" />
        <img src={astralTutor} alt="" aria-hidden="true" />
        <span className="mascot-spark" aria-hidden="true" />
      </div>
      <figcaption>{presentation.announcement}</figcaption>
    </figure>
  );
}
