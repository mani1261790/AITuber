import type { BlackboardDrawing, LessonDirectionView } from "@aituber/contracts";
import { useEffect, useRef, useState } from "react";
import { toCanvas } from "html-to-image";
import { rasterFontCss } from "./raster-fonts.ts";
import type { StageScene, StageTarget } from "@aituber/presentation";
import { RichText } from "./rich-text.tsx";
import { TargetView } from "./target-view.tsx";
import { VrmAvatar } from "./vrm-avatar.tsx";
import type { MascotPresentation } from "@aituber/presentation";

export interface LessonImage { canvas: HTMLCanvasElement; boardCanvas: HTMLCanvasElement; regions: ImageRegion[]; boardRegions: ImageRegion[]; drawingId?: string }
interface ImageRegion { id: string; x: number; y: number; width: number; height: number; anchorX: number }

export function LessonStage({ listening = false, speaking, readSpeechLevel, scene, notes = [], noteText, presentation, projecting, onSelect, direction, onStageComplete, onStageProgress }: { listening?: boolean; speaking?: boolean | undefined; readSpeechLevel?: (()=>number|undefined)|undefined; direction?: LessonDirectionView | null | undefined; onStageComplete?: ((actionId: string) => void) | undefined; onStageProgress?: ((actionId: string) => void) | undefined; scene: StageScene; notes?: StageTarget[]; noteText?: string | undefined; presentation: MascotPresentation; projecting: boolean; onSelect(id: string): void }) {
  const stageComplete = useRef(onStageComplete);
  stageComplete.current = onStageComplete;
  const source = useRef<HTMLDivElement>(null);
  const boardSource = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<LessonImage | null>(null);
  const [error, setError] = useState(false);
  const drawing = direction?.drawing;
  const contentKey = JSON.stringify({ title: scene.title, targets: scene.targets.filter(t => t.visible).map(t => ({ ...t, focused: false })), notes, noteText, drawing });
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
      if (!active) return;
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
      const fontEmbedCSS = await rasterFontCss(node);
      if (!active) return;
      const canvas = await toCanvas(node, { ...options, fontEmbedCSS });
      if (!active) return;
      let boardCanvas: HTMLCanvasElement;
      if (drawing || (!notes.length && !noteText)) {
        // Empty boards need no DOM/font rasterization. Specialist SVGs replace
        // the whole surface below, so their temporary background is unused.
        boardCanvas = document.createElement("canvas");
        boardCanvas.width = options.width; boardCanvas.height = options.height;
        const context = boardCanvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        context.fillStyle = getComputedStyle(boardNode).backgroundColor;
        context.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
      } else {
        const boardFonts = await rasterFontCss(boardNode);
        if (!active) return;
        boardCanvas = await toCanvas(boardNode, { ...options, fontEmbedCSS: boardFonts });
      }
      if (!active) return;
      const measure = (root: HTMLElement) => { const parent = root.getBoundingClientRect();
      return [...root.querySelectorAll<HTMLElement>("[data-semantic-id]")].map(element => {
        const rect = element.getBoundingClientRect();
        const content = element.querySelector(".katex, svg, img")?.getBoundingClientRect();
        const anchorX = content ? (content.x+content.width/2-parent.x)/1280 : (rect.x-parent.x)/1280+.15;
        return { id: element.dataset.semanticId!, x: (rect.x-parent.x)/1280, y: (rect.y-parent.y)/720, width: rect.width/1280, height: rect.height/720, anchorX };
      }); };
      const svgRegion = drawing ? await paintBlackboardSvg(drawing,boardCanvas) : null;
      if (active) setImage({ canvas, boardCanvas, regions: measure(node), boardRegions: svgRegion ? [svgRegion] : measure(boardNode), ...(drawing ? {drawingId:drawing.id} : {}) });
    })().catch(() => { if (active) setError(true); }).finally(() => { node.remove(); boardNode.remove(); });
    return () => { active = false; };
  }, [contentKey]);
  useEffect(() => {
    if (direction?.phase !== "drawing" || !drawing || image?.drawingId !== drawing.id || error) return;
    // Let the projection sheet retract and the texture upload before acknowledging readiness.
    const timer = setTimeout(()=>stageComplete.current?.(direction.actionId),900);
    return ()=>clearTimeout(timer);
  },[direction?.phase,direction?.actionId,drawing?.id,image?.drawingId,error]);
  return <>
    <div className="lesson-image-source" aria-hidden="true" inert ref={source}><h2>{scene.title}</h2><div className="image-targets">{scene.targets.filter(t => t.visible).map(target => <TargetView key={target.id} target={{...target, focused:false}} onSelect={() => {}} />)}</div></div>
    <div className="lesson-image-source lesson-image-source--board" aria-hidden="true" inert ref={boardSource}>{(notes.length > 0 || noteText) && <><h2>補足メモ</h2><div className="image-targets">{notes.map(target => <TargetView key={target.id} target={{...target, focused:false}} onSelect={() => {}} />)}{noteText && <RichText text={noteText} />}</div></>}</div>
    <VrmAvatar listening={listening} speaking={speaking} readSpeechLevel={readSpeechLevel} state={presentation.state} mouthOpen={presentation.mouthOpen} targetId={presentation.targetId} lessonImage={image} projecting={projecting} onSelect={onSelect} direction={direction} onStageComplete={onStageComplete} onStageProgress={onStageProgress} />
    <div className="sr-only" aria-label="教材の内容"><h2>{scene.title}</h2>{scene.targets.filter(t => t.visible).map(target => <p key={target.id}>{target.label}: {target.content}</p>)}</div>
    {!image && <span className="stage-loading" role="status">{error ? "教材画像を作成できません。再読み込みしてください。" : "教材を準備中…"}</span>}
    {image && direction?.phase === "planning" && <span className="stage-loading director-planning" role="status">次の説明を準備中…</span>}
    <details className="stage-credits"><summary>素材</summary><p>Classroom by <a href="https://www.blender.org/download/demo-files/" target="_blank" rel="noreferrer">Christophe Seux</a> · <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noreferrer">CC0</a><br />配置・縮尺・質感を調整しています。</p></details>
  </>;
}

/** Measure the specialist's actual SVG, then rasterize without changing its layout. */
export async function paintBlackboardSvg(drawing: BlackboardDrawing, canvas: HTMLCanvasElement): Promise<ImageRegion> {
  const doc = new DOMParser().parseFromString(drawing.svg,"image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid SVG");
  const svg = document.importNode(doc.documentElement,true) as unknown as SVGSVGElement;
  svg.style.position="fixed"; svg.style.left="-10000px"; svg.style.top="0";
  document.body.append(svg);
  let bounds: DOMRect;
  try {
    await document.fonts.ready;
    bounds=svg.getBBox();
    if (![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || bounds.x < 80 || bounds.y < 80 || bounds.x+bounds.width > 1520 || bounds.y+bounds.height > 820) throw new Error("SVG exceeds the blackboard safe area");
    const labels=[...svg.querySelectorAll<SVGGraphicsElement>("text")];
    for (let i=0;i<labels.length;i++) {
      const a=labels[i]!.getBoundingClientRect();
      for (const other of labels.slice(i+1)) {
        const b=other.getBoundingClientRect();
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) throw new Error("SVG labels overlap");
      }
    }
    for (const text of svg.querySelectorAll<SVGGraphicsElement>("text,tspan")) {
      const matrix=text.getCTM();
      if (!matrix || Number.parseFloat(getComputedStyle(text).fontSize)*Math.min(Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d)) < 48) throw new Error("SVG text too small");
    }
  } finally { svg.remove(); }
  const url=URL.createObjectURL(new Blob([drawing.svg],{type:"image/svg+xml"}));
  try {
    const image=new Image(); image.src=url; await image.decode();
    const ctx=canvas.getContext("2d"); if (!ctx) throw new Error("Canvas unavailable");
    ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle="#1d342e"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
  } finally { URL.revokeObjectURL(url); }
  return {id:drawing.id,x:bounds.x/1600,y:bounds.y/900,width:bounds.width/1600,height:bounds.height/900,anchorX:(bounds.x+bounds.width/2)/1600};
}
