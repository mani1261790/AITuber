import { localAssetUrl, type StageTarget } from "@aituber/presentation";

export function TargetView({ target, onSelect }: { target: StageTarget; onSelect: (targetId: string) => void }) {
  return (
    <button
      className={`target target--${target.kind}`}
      data-semantic-id={target.id}
      aria-pressed={target.focused}
      aria-label={`${target.label}を質問対象に選ぶ`}
      onClick={() => onSelect(target.id)}
      type="button"
    >
      <span className="target-label">{target.label}</span>
      {target.kind === "image" && target.assetId ? (
        <img src={localAssetUrl(target.assetId)} alt={target.altText ?? target.label} />
      ) : target.kind === "formula" ? (
        <span className="formula" role="math" aria-label={target.label}>{target.content}</span>
      ) : (
        <span className="target-content">{target.content}</span>
      )}
      {target.focused && <span className="selected-cue">選択中</span>}
    </button>
  );
}
