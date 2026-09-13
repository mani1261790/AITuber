import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CourseSummary, FixedSessionView, SessionCommandRequest } from "@aituber/contracts";
import "./styles.css";

const statusLabels: Record<FixedSessionView["status"], string> = {
  PREPARING: "準備中", TEACHING: "講義中", CHECKPOINT: "確認問題", PAUSED: "一時停止中", RECOVERING: "再開中", FINISHED: "終了",
};

function OperatorApp() {
  const [courses, setCourses] = useState<readonly CourseSummary[]>([]);
  const [courseId, setCourseId] = useState("");
  const [duration, setDuration] = useState(6);
  const [session, setSession] = useState<FixedSessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedCourse = courses.find((course) => course.id === courseId) ?? null;

  useEffect(() => {
    void Promise.all([fetchJson<{ courses: CourseSummary[] }>("/api/courses"), fetchJson<{ session: FixedSessionView | null }>("/api/sessions/current")])
      .then(([courseResult, sessionResult]) => {
        setCourses(courseResult.courses);
        const first = courseResult.courses[0];
        if (first) { setCourseId(first.id); setDuration(first.durationMinutes); }
        setSession(sessionResult.session);
      })
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, []);

  useEffect(() => {
    if (!session || session.status === "FINISHED") return;
    let active = true;
    const timer = window.setInterval(() => {
      void fetchJson<{ session: FixedSessionView }>(`/api/sessions/${encodeURIComponent(session.id)}`)
        .then((result) => { if (active) setSession(result.session); })
        .catch((reason: unknown) => { if (active) setError(errorMessage(reason)); });
    }, 100);
    return () => { active = false; window.clearInterval(timer); };
  }, [session?.id, session?.status]);

  async function startLecture() {
    setBusy(true); setError(null);
    try {
      const result = await fetchJson<{ session: FixedSessionView }>("/api/sessions", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coursePackageId: courseId, durationMinutes: duration }),
      });
      setSession(result.session);
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }

  async function command(request: SessionCommandRequest) {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const result = await fetchJson<{ session: FixedSessionView }>(`/api/sessions/${encodeURIComponent(session.id)}/commands`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request),
      });
      setSession(result.session);
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }

  return (
    <main className="operator-shell">
      <header className="page-header">
        <h1>講義を開始する</h1>
        <p>教材と授業時間を確認して開始すると、確認問題まで自動で進みます。</p>
      </header>

      <section className="panel" aria-labelledby="course-heading">
        <h2 id="course-heading">授業設定</h2>
        <label className="field">教材
          <select value={courseId} onChange={(event) => {
            const nextId = event.target.value; setCourseId(nextId);
            const next = courses.find((course) => course.id === nextId); if (next) setDuration(next.durationMinutes);
          }} disabled={busy || courses.length === 0}>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select>
        </label>
        {selectedCourse && <dl className="course-facts">
          <div><dt>対象レベル</dt><dd>{selectedCourse.targetLevel}</dd></div>
          <div><dt>学習目標</dt><dd><ul>{selectedCourse.learningGoals.map((goal) => <li key={goal.id}>{goal.description}</li>)}</ul></dd></div>
        </dl>}
        <label className="field field--duration">授業時間
          <span><input type="number" min="1" max="480" value={duration} onChange={(event) => setDuration(event.target.valueAsNumber)} /> 分</span>
        </label>
        <button className="primary-button" type="button" disabled={busy || !courseId || !Number.isInteger(duration)} onClick={() => void startLecture()}>講義を開始</button>
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      {session && <section className="panel session-panel" aria-labelledby="session-heading">
        <div className="session-heading"><div><p className={`status status--${session.status.toLowerCase()}`}>{statusLabels[session.status]}</p><h2 id="session-heading">{session.course.title}</h2></div><strong>{session.progress.completed} / {session.progress.total}</strong></div>
        <progress value={session.progress.completed} max={session.progress.total}>{session.progress.completed} / {session.progress.total}</progress>
        {session.speech.mode === "caption-fallback" && <p className="speech-warning">音声合成に失敗したため、字幕で講義を続けています。</p>}
        <p><a href={`http://127.0.0.1:4311/?session=${encodeURIComponent(session.id)}`} target="_blank" rel="noreferrer">教室画面を開く</a></p>
        {session.status !== "FINISHED" && <div className="actions">
          {session.status === "PAUSED"
            ? <button type="button" disabled={busy} onClick={() => void command({ command: "resume" })}>再開</button>
            : <button type="button" disabled={busy || session.status === "RECOVERING"} onClick={() => void command({ command: "pause" })}>一時停止</button>}
          <button className="quiet-button" type="button" disabled={busy} onClick={() => void command({ command: "finish" })}>ここで終了</button>
        </div>}
        {session.status === "FINISHED" && <div className="result" aria-label="講義結果">
          <p><strong>説明完了:</strong> {session.completedUnitIds.length} 件</p>
          <p><strong>未完了:</strong> {session.unfinishedUnitIds.length} 件</p>
        </div>}
      </section>}
    </main>
  );
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const value = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(value.message ?? `HTTP ${response.status}`);
  return value;
}

function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : "処理に失敗しました。"; }

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Operator root element was not found");
createRoot(root).render(<StrictMode><OperatorApp /></StrictMode>);
