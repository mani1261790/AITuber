import { useEffect, useRef, useState } from "react";
import { toCanvas } from "html-to-image";
import type { StageScene } from "@aituber/presentation";
import { TargetView } from "./target-view.tsx";
import { VrmAvatar } from "./vrm-avatar.tsx";
import type { MascotPresentation } from "@aituber/presentation";

export interface LessonImage { canvas: HTMLCanvasElement; boardCanvas: HTMLCanvasElement; regions: { id: string; x: number; y: number; width: number; height: number }[] }

export function LessonStage({ scene, presentation, projecting, onSelect }: { scene: StageScene; presentation: MascotPresentation; projecting: boolean; onSelect(id: string): void }) {
  const source = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<LessonImage | null>(null);
  const [error, setError] = useState(false);
  const contentKey = JSON.stringify({ title: scene.title, targets: scene.targets.filter(t => t.visible).map(t => ({ ...t, focused: false })) });
  useEffect(() => {
    let active = true;
    if (!source.current) return;
    // Freeze this revision while fonts and image resources are loaded asynchronously.
    const node = source.current.cloneNode(true) as HTMLDivElement;
    document.body.append(node);
    setError(false);
    void (async () => {
      await document.fonts.ready;
      // Preserve SVG presentation when embedded in the rasterizer's foreignObject.
      for (const element of node.querySelectorAll<SVGElement>("svg, svg *")) {
        const computed = getComputedStyle(element);
        for (const property of ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "font-size", "font-family", "font-weight"]) {
          element.setAttribute(property, computed.getPropertyValue(property));
        }
        element.style.animation = "none";
        element.style.strokeDashoffset = "0";
      }
      const options = { pixelRatio: 1, width: 1280, height: 720, preferredFontFormat: "woff2", style: { position: "static", left: "0", top: "0" } };
      const canvas = await toCanvas(node, options);
      node.classList.add("lesson-image-source--board");
      const boardCanvas = await toCanvas(node, options);
      node.classList.remove("lesson-image-source--board");
      const parent = node.getBoundingClientRect();
      const regions = [...node.querySelectorAll<HTMLElement>("[data-semantic-id]")].map(element => {
        const rect = element.getBoundingClientRect();
        return { id: element.dataset.semanticId!, x: (rect.x-parent.x)/1280, y: (rect.y-parent.y)/720, width: rect.width/1280, height: rect.height/720 };
      });
      if (active) setImage({ canvas, boardCanvas, regions });
    })().catch(() => { if (active) setError(true); }).finally(() => node.remove());
    return () => { active = false; };
  }, [contentKey]);
  return <>
    <div className="lesson-image-source" aria-hidden="true" inert ref={source}><h2>{scene.title}</h2><div className="image-targets">{scene.targets.filter(t => t.visible).map(target => <TargetView key={target.id} target={{...target, focused:false}} onSelect={() => {}} />)}</div></div>
    <VrmAvatar state={presentation.state} mouthOpen={presentation.mouthOpen} targetId={presentation.targetId} lessonImage={image} projecting={projecting} onSelect={onSelect} />
    <div className="sr-only" aria-label="教材の内容"><h2>{scene.title}</h2>{scene.targets.filter(t => t.visible).map(target => <p key={target.id}>{target.label}: {target.content}</p>)}</div>
    {!image && <span className="stage-loading" role="status">{error ? "教材画像を作成できません。再読み込みしてください。" : "教材を準備中…"}</span>}
  </>;
}
