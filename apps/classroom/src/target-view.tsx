import { localAssetUrl, type StageTarget } from "@aituber/presentation";
import { FormulaView } from "./formula-view.tsx";
import { DiagramView } from "./diagram-view.tsx";

export function TargetView({ target, onSelect }: { target: StageTarget; onSelect: (targetId: string) => void }) {
  return (
    <button
      className={`target target--${target.kind}`}
      data-semantic-id={target.id}
      aria-pressed={target.focused}
      onClick={() => onSelect(target.id)}
      type="button"
    >
      <span className="target-label">{target.label}</span>
      {target.kind === "image" && target.assetId ? (
        <img src={localAssetUrl(target.assetId)} alt={target.altText ?? target.label} />
      ) : target.kind === "formula" ? (
        <FormulaView tex={target.content} />
      ) : target.kind === "diagram" ? (
        <DiagramView target={target} />
      ) : (
        <span className="target-content">{target.content}</span>
      )}
      {target.focused && <span className="selected-cue">選択中</span>}
      <span className="sr-only">について質問する</span>
    </button>
  );
}
