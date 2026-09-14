import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StageScene, StageTarget } from "@aituber/presentation";
import { LessonStage } from "./lesson-texture.tsx";

const target: StageTarget = { id: "target.slide", sceneId: "scene.test", kind: "text", label: "教材", content: "スライドだけの本文", sourceIds: ["source.test"], visible: true, focused: false };
const scene: StageScene = { id: "scene.test", title: "授業", templateId: "document", targets: [target], focusedTargetId: null, focusedTargetIds: new Set() };
const presentation = { state: "normal" as const, mouthOpen: false, targetId: null, announcement: "説明中" };

describe("separate lesson and notes surfaces", () => {
  it("leaves the blackboard empty without supplement notes", () => {
    const html = renderToStaticMarkup(<LessonStage scene={scene} presentation={presentation} projecting onSelect={() => {}} />);
    const board = html.split('class="lesson-image-source lesson-image-source--board"')[1]!.split('class="vrm-avatar"')[0]!;
    expect(board).not.toContain("スライドだけの本文");
    expect(board).not.toContain("補足メモ");
  });
  it("renders independent notes without putting them on the lesson slide", () => {
    const html = renderToStaticMarkup(<LessonStage scene={scene} notes={[{ ...target, content: "補足だけの本文" }]} presentation={presentation} projecting={false} onSelect={() => {}} />);
    const [slide, rest] = html.split('class="lesson-image-source lesson-image-source--board"');
    expect(slide).toContain("スライドだけの本文");
    expect(slide).not.toContain("補足だけの本文");
    const board = rest!.split('class="vrm-avatar"')[0]!;
    expect(board).toContain("補足だけの本文");
    expect(board).not.toContain("スライドだけの本文");
  });
});
