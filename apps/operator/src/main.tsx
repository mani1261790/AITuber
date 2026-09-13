import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ClassroomRoomView, CourseSummary, FixedSessionView, SessionCommandRequest } from "@aituber/contracts";
import "@fontsource/zen-kaku-gothic-new/japanese-400.css";
import "@fontsource/zen-kaku-gothic-new/japanese-500.css";
import "@fontsource/zen-kaku-gothic-new/japanese-700.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles.css";

declare const __AITUBER_CLASSROOM_HOST__: string;

const statusLabels: Record<FixedSessionView["status"], string> = {
  PREPARING: "準備中", TEACHING: "講義中", CHECKPOINT: "確認問題", PAUSED: "一時停止中", RECOVERING: "再開中", FINISHED: "終了",
};

function OperatorApp() {
  const [courses, setCourses] = useState<readonly CourseSummary[]>([]);
  const [courseId, setCourseId] = useState("");
  const [duration, setDuration] = useState(6);
  const [session, setSession] = useState<FixedSessionView | null>(null);
  const [classroom, setClassroom] = useState<ClassroomRoomView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedCourse = courses.find((course) => course.id === courseId) ?? null;

  useEffect(() => {
    void Promise.all([fetchJson<{ courses: CourseSummary[] }>("/api/courses"), fetchJson<{ session: FixedSessionView | null; classroom: ClassroomRoomView | null }>("/api/sessions/current")])
      .then(([courseResult, sessionResult]) => {
        setCourses(courseResult.courses);
        const first = courseResult.courses[0];
        if (first) { setCourseId(first.id); setDuration(first.durationMinutes); }
        setSession(sessionResult.session);
        setClassroom(sessionResult.classroom);
      })
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, []);

  useEffect(() => {
    if (!session || session.status === "FINISHED") return;
    let active = true;
    const timer = window.setInterval(() => {
      void fetchJson<{ session: FixedSessionView; classroom: ClassroomRoomView }>(`/api/sessions/${encodeURIComponent(session.id)}`)
        .then((result) => { if (active) { setSession(result.session); setClassroom(result.classroom); } })
        .catch((reason: unknown) => { if (active) setError(errorMessage(reason)); });
    }, 100);
    return () => { active = false; window.clearInterval(timer); };
  }, [session?.id, session?.status]);

  async function startLecture() {
    setBusy(true); setError(null);
    try {
      const result = await fetchJson<{ session: FixedSessionView; classroom: ClassroomRoomView }>("/api/sessions", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coursePackageId: courseId, durationMinutes: duration }),
      });
      setSession(result.session);
      setClassroom(result.classroom);
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }

  async function command(request: SessionCommandRequest) {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const result = await fetchJson<{ session: FixedSessionView; classroom: ClassroomRoomView }>(`/api/sessions/${encodeURIComponent(session.id)}/commands`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request),
      });
      setSession(result.session);
      setClassroom(result.classroom);
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }

  return (
    <main className="operator-shell">
      <header className="page-header">
        <div className="studio-brand"><span className="studio-sigil" aria-hidden="true"><span /></span><span>AITUBER</span></div>
        <p className="page-kicker">LECTURE CONTROL</p>
        <h1>講義をセットする</h1>
        <p>教材と時間を決めて開始すると、確認問題まで自動で進みます。</p>
      </header>

      <div className="operator-grid">
        <section className="panel setup-panel" aria-labelledby="course-heading">
          <div className="panel-heading"><span>01</span><div><p>SESSION SETUP</p><h2 id="course-heading">授業設定</h2></div></div>
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
            <span><input type="number" min="1" max="480" value={duration} onChange={(event) => setDuration(event.target.valueAsNumber)} /><b>分</b></span>
          </label>
          <button className="primary-button" type="button" disabled={busy || !courseId || !Number.isInteger(duration)} onClick={() => void startLecture()}><span aria-hidden="true" />講義を開始</button>
        </section>

        <div className="monitor-column">
          {error && <p className="error" role="alert">{error}</p>}
          {session ? <section className="panel session-panel" aria-labelledby="session-heading">
            <div className="panel-heading"><span>02</span><div><p>LIVE MONITOR</p><h2>進行状況</h2></div></div>
            <div className="session-heading"><div><p className={`status status--${session.status.toLowerCase()}`}><span aria-hidden="true" />{statusLabels[session.status]}</p><h3 id="session-heading">{session.course.title}</h3></div><strong><span>UNIT</span>{session.progress.completed}<b>/</b>{session.progress.total}</strong></div>
            <progress value={session.progress.completed} max={session.progress.total}>{session.progress.completed} / {session.progress.total}</progress>
            {session.speech.mode === "caption-fallback" && <p className="speech-warning">音声合成に失敗したため、字幕で講義を続けています。</p>}
            {classroom && <div className="classroom-access"><div><span>教室コード</span><strong>{classroom.code}</strong></div><p>{classroom.participantCount} / {classroom.capacity} 人参加</p></div>}
            {classroom && <a className="classroom-link" href={`${window.location.protocol}//${__AITUBER_CLASSROOM_HOST__}:4311/?code=${encodeURIComponent(classroom.code)}`} target="_blank" rel="noreferrer"><span>教室画面を開く</span><b aria-hidden="true">↗</b></a>}
            {session.status !== "FINISHED" && <div className="actions">
              {session.status === "PAUSED"
                ? <button type="button" disabled={busy} onClick={() => void command({ command: "resume" })}>再開</button>
                : <button type="button" disabled={busy || session.status === "RECOVERING"} onClick={() => void command({ command: "pause" })}>一時停止</button>}
              <button className="quiet-button" type="button" disabled={busy} onClick={() => void command({ command: "finish" })}>ここで終了</button>
            </div>}
            {session.status === "FINISHED" && <div className="result" aria-label="講義結果">
              <p><span>説明完了</span><strong>{session.completedUnitIds.length}</strong></p>
              <p><span>未完了</span><strong>{session.unfinishedUnitIds.length}</strong></p>
            </div>}
          </section> : <section className="monitor-empty" aria-label="進行状況"><span>02</span><div><p>LIVE MONITOR</p><h2>開始すると、ここに進行状況が表示されます。</h2></div></section>}
        </div>
      </div>
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
