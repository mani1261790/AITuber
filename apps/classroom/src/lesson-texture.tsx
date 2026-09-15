import type { LessonDirectionView } from "@aituber/contracts";
import { useEffect, useRef, useState } from "react";
import { toCanvas } from "html-to-image";
import type { StageScene, StageTarget } from "@aituber/presentation";
import { RichText } from "./rich-text.tsx";
import { TargetView } from "./target-view.tsx";
import { VrmAvatar } from "./vrm-avatar.tsx";
import type { MascotPresentation } from "@aituber/presentation";

export interface LessonImage { canvas: HTMLCanvasElement; boardCanvas: HTMLCanvasElement; regions: ImageRegion[]; boardRegions: ImageRegion[] }
interface ImageRegion { id: string; x: number; y: number; width: number; height: number; anchorX: number }

export function LessonStage({ scene, notes = [], noteText, presentation, projecting, onSelect, direction, onStageComplete }: { direction?: LessonDirectionView | null | undefined; onStageComplete?: ((actionId: string) => void) | undefined; scene: StageScene; notes?: StageTarget[]; noteText?: string | undefined; presentation: MascotPresentation; projecting: boolean; onSelect(id: string): void }) {
  const source = useRef<HTMLDivElement>(null);
  const boardSource = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<LessonImage | null>(null);
  const [error, setError] = useState(false);
  const contentKey = JSON.stringify({ title: scene.title, targets: scene.targets.filter(t => t.visible).map(t => ({ ...t, focused: false })), notes, noteText });
  useEffect(() => {
    let active = true;
    if (!source.current || !boardSource.current) return;
    // Freeze this revision while fonts and image resources are loaded asynchronously.
    const node = source.current.cloneNode(true) as HTMLDivElement;
    const boardNode = boardSource.current.cloneNode(true) as HTMLDivElement;
    document.body.append(node);
    document.body.append(boardNode);
    setError(false);
    void (async () => {
      await document.fonts.ready;
      // Preserve SVG presentation when embedded in the rasterizer's foreignObject.
      for (const element of [...node.querySelectorAll<SVGElement>("svg, svg *"), ...boardNode.querySelectorAll<SVGElement>("svg, svg *")]) {
        const computed = getComputedStyle(element);
        for (const property of ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "font-size", "font-family", "font-weight"]) {
          element.setAttribute(property, computed.getPropertyValue(property));
        }
        element.style.animation = "none";
        element.style.strokeDashoffset = "0";
      }
      const options = { pixelRatio: 1, width: 1280, height: 720, preferredFontFormat: "woff2", style: { position: "static", left: "0", top: "0" } };
      const canvas = await toCanvas(node, options);
      const boardCanvas = await toCanvas(boardNode, options);
      const measure = (root: HTMLElement) => { const parent = root.getBoundingClientRect();
      return [...root.querySelectorAll<HTMLElement>("[data-semantic-id]")].map(element => {
        const rect = element.getBoundingClientRect();
        const content = element.querySelector(".katex, svg, img")?.getBoundingClientRect();
        const anchorX = content ? (content.x+content.width/2-parent.x)/1280 : (rect.x-parent.x)/1280+.15;
        return { id: element.dataset.semanticId!, x: (rect.x-parent.x)/1280, y: (rect.y-parent.y)/720, width: rect.width/1280, height: rect.height/720, anchorX };
      }); };
      if (active) setImage({ canvas, boardCanvas, regions: measure(node), boardRegions: measure(boardNode) });
    })().catch(() => { if (active) setError(true); }).finally(() => { node.remove(); boardNode.remove(); });
    return () => { active = false; };
  }, [contentKey]);
  return <>
    <div className="lesson-image-source" aria-hidden="true" inert ref={source}><h2>{scene.title}</h2><div className="image-targets">{scene.targets.filter(t => t.visible).map(target => <TargetView key={target.id} target={{...target, focused:false}} onSelect={() => {}} />)}</div></div>
    <div className="lesson-image-source lesson-image-source--board" aria-hidden="true" inert ref={boardSource}>{(notes.length > 0 || noteText) && <><h2>補足メモ</h2><div className="image-targets">{notes.map(target => <TargetView key={target.id} target={{...target, focused:false}} onSelect={() => {}} />)}{noteText && <RichText text={noteText} />}</div></>}</div>
    <VrmAvatar state={presentation.state} mouthOpen={presentation.mouthOpen} targetId={presentation.targetId} lessonImage={image} projecting={projecting} onSelect={onSelect} direction={direction} onStageComplete={onStageComplete} />
    <div className="sr-only" aria-label="教材の内容"><h2>{scene.title}</h2>{scene.targets.filter(t => t.visible).map(target => <p key={target.id}>{target.label}: {target.content}</p>)}</div>
    {!image && <span className="stage-loading" role="status">{error ? "教材画像を作成できません。再読み込みしてください。" : "教材を準備中…"}</span>}
    {image && direction?.phase === "planning" && <span className="stage-loading director-planning" role="status">次の説明を準備中…</span>}
    <details className="stage-credits"><summary>素材</summary><p>Classroom by <a href="https://www.blender.org/download/demo-files/" target="_blank" rel="noreferrer">Christophe Seux</a> · <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noreferrer">CC0</a><br />配置・縮尺・質感を調整しています。</p></details>
  </>;
}
