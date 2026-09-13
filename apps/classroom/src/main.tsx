import { StrictMode, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { FixedSessionView } from "@aituber/contracts";
import { applyBoardPatches, createBoardState, focusSemanticTarget, resolveStageScene } from "@aituber/presentation";
import { TargetView } from "./target-view.tsx";
import "./styles.css";

const statusLabels: Record<FixedSessionView["status"], string> = {
  PREPARING: "準備中", TEACHING: "講義中", CHECKPOINT: "確認問題", PAUSED: "一時停止中", RECOVERING: "再開中", FINISHED: "講義終了",
};

function ClassroomApp() {
  const [session, setSession] = useState<FixedSessionView | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionId = new URLSearchParams(window.location.search).get("session");

  useEffect(() => {
    let active = true;
    const path = sessionId ? `/api/sessions/${encodeURIComponent(sessionId)}` : "/api/sessions/current";
    const load = () => void fetchJson<{ session: FixedSessionView | null }>(path)
      .then((result) => { if (active) { setSession(result.session); setError(null); } })
      .catch((reason: unknown) => { if (active) setError(errorMessage(reason)); });
    load();
    const timer = window.setInterval(load, 400);
    return () => { active = false; window.clearInterval(timer); };
  }, [sessionId]);

  const displayUnit = session?.course.teachingUnits.find((unit) => unit.id === session.displayUnitId) ?? null;
  const scene = useMemo(() => {
    if (!session || !displayUnit) return null;
    let board = applyBoardPatches(session.course, createBoardState(session.course, displayUnit.sceneId), displayUnit.boardPatches);
    board = focusSemanticTarget(session.course, board, selectedTargetId ?? displayUnit.focusTargetIds[0] ?? null);
    return resolveStageScene(session.course, displayUnit.sceneId, board);
  }, [session, displayUnit, selectedTargetId]);
  const currentGoal = displayUnit
    ? session?.course.learningGoals.find((goal) => displayUnit.learningGoalIds.includes(goal.id))?.description
    : null;

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!session || !answer.trim()) return;
    setAnswering(true); setError(null);
    try {
      const result = await fetchJson<{ session: FixedSessionView }>(`/api/sessions/${encodeURIComponent(session.id)}/commands`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "answer", answer: answer.trim() }),
      });
      setSession(result.session); setAnswer("");
    } catch (reason) { setError(errorMessage(reason)); } finally { setAnswering(false); }
  }

  if (error && !session) return <CenteredMessage title="教室を開けません" detail={error} />;
  if (!session) return <CenteredMessage title="開始を待っています" detail="運営画面で教材を選び、講義を開始してください。" />;

  return (
    <main className="classroom-shell">
      <header className="lesson-header">
        <div>
          <p className={`lesson-status lesson-status--${session.status.toLowerCase()}`}><span aria-hidden="true">●</span> {statusLabels[session.status]}</p>
          <h1>{session.course.title}</h1>
          <p className="current-concept">現在の学習目標: <strong>{currentGoal ?? "講義のまとめ"}</strong></p>
        </div>
        <p className="lesson-progress" aria-label="講義の進行状況">{session.progress.completed} / {session.progress.total}</p>
      </header>

      {session.status === "PAUSED" && <p className="notice" role="status">講義は一時停止中です。再開すると、この説明から続きます。</p>}
      {session.testAudio.playing && <div className="playback" role="status"><span className="playback-dot" aria-hidden="true" />固定テスト音声を再生中</div>}
      {error && <p className="error" role="alert">{error}</p>}

      {scene && <section className="stage" aria-labelledby="scene-title">
        <div className="scene-heading"><h2 id="scene-title">{scene.title}</h2><p>質問したい箇所を選べます</p></div>
        <div className={`scene-grid scene-grid--${scene.templateId}`}>
          {scene.targets.filter((target) => target.visible).map((target) => <TargetView key={target.id} target={target} onSelect={setSelectedTargetId} />)}
        </div>
      </section>}

      {displayUnit && <section className="caption" aria-labelledby="caption-title" aria-live="polite"><h2 id="caption-title">字幕</h2><p>{displayUnit.captionText}</p></section>}

      {session.status === "CHECKPOINT" && session.assessment && <section className="checkpoint" aria-labelledby="checkpoint-title">
        <h2 id="checkpoint-title">確認問題</h2><p>{session.assessment.prompt}</p>
        <form onSubmit={(event) => void submitAnswer(event)}>
          {session.assessment.responseKind === "multiple-choice" ? <fieldset><legend>回答を一つ選んでください</legend>{session.assessment.options.map((option) => <label key={option}><input type="radio" name="answer" value={option} checked={answer === option} onChange={() => setAnswer(option)} /> {option}</label>)}</fieldset>
            : <label className="answer-field">回答<input value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>}
          <button type="submit" disabled={answering || !answer.trim()}>回答して続ける</button>
        </form>
      </section>}

      {session.status === "FINISHED" && <section className="finish-result" aria-labelledby="result-title">
        <h2 id="result-title">講義結果</h2>
        <p>{session.unfinishedUnitIds.length === 0 ? "予定していた説明をすべて完了しました。" : "途中で終了しました。未完了の説明は次回へ残ります。"}</p>
        <dl><div><dt>説明完了</dt><dd>{session.completedUnitIds.length} 件</dd></div><div><dt>未完了</dt><dd>{session.unfinishedUnitIds.length} 件</dd></div></dl>
      </section>}

      {scene && session.status !== "FINISHED" && <nav className="target-list" aria-label="質問対象"><h2>質問する箇所</h2><div className="target-controls">{scene.targets.map((target) => <button key={target.id} type="button" aria-pressed={target.focused} onClick={() => setSelectedTargetId(target.id)}>{target.label}{target.focused ? "（選択中）" : ""}</button>)}</div></nav>}
    </main>
  );
}

function CenteredMessage({ title, detail }: { title: string; detail: string }) { return <main className="centered-message"><h1>{title}</h1><p>{detail}</p></main>; }
async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> { const response = await fetch(input, init); const value = await response.json() as T & { message?: string }; if (!response.ok) throw new Error(value.message ?? `HTTP ${response.status}`); return value; }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : "処理に失敗しました。"; }

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Classroom root element was not found");
createRoot(root).render(<StrictMode><ClassroomApp /></StrictMode>);
