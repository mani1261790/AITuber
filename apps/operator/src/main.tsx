import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AuthoringJobView, AuthoringSourceUpload, ClassroomRoomView, CourseSummary, FixedSessionView, LlmSettingsView, SessionCommandRequest } from "@aituber/contracts";
import "@fontsource/zen-kaku-gothic-new/japanese-400.css";
import "@fontsource/zen-kaku-gothic-new/japanese-500.css";
import "@fontsource/zen-kaku-gothic-new/japanese-700.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles.css";

declare const __AITUBER_CLASSROOM_HOST__: string;

const statusLabels: Record<FixedSessionView["status"], string> = {
  PREPARING: "準備中", TEACHING: "講義中", CHECKPOINT: "確認問題", PAUSED: "一時停止中", RECOVERING: "再開中", FINISHED: "終了",
};
const gateLabels: Record<NonNullable<AuthoringJobView["review"]>["gates"][number]["id"], string> = {
  "source-alignment": "出典と内容", "factual-consistency": "事実・式・数値", "goal-alignment": "学習目標", prerequisites: "前提関係", references: "参照ID", renderability: "描画可能性", "speech-caption": "発話と字幕", "safe-content": "安全な内容", rights: "利用権",
};

function OperatorApp() {
  const [courses, setCourses] = useState<readonly CourseSummary[]>([]);
  const [courseId, setCourseId] = useState("");
  const [duration, setDuration] = useState(6);
  const [session, setSession] = useState<FixedSessionView | null>(null);
  const [classroom, setClassroom] = useState<ClassroomRoomView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [llmSettings, setLlmSettings] = useState<LlmSettingsView | null>(null);
  const [llmKey, setLlmKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [sourceNote, setSourceNote] = useState("");
  const [sourceRights, setSourceRights] = useState<AuthoringSourceUpload["rights"]["basis"]>("owned");
  const [targetLevel, setTargetLevel] = useState("");
  const [learningGoals, setLearningGoals] = useState("");
  const [authoringJob, setAuthoringJob] = useState<AuthoringJobView | null>(null);
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
    void fetchJson<{ jobs: AuthoringJobView[] }>("/api/authoring/jobs").then(({ jobs }) => setAuthoringJob(jobs[0] ?? null)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!authoringJob || authoringJob.status !== "running") return;
    const timer = window.setInterval(() => void fetchJson<{ job: AuthoringJobView }>(`/api/authoring/jobs/${encodeURIComponent(authoringJob.id)}`).then(({ job }) => {
      setAuthoringJob(job);
      if (job.status === "available" && job.course) void refreshCourses(job.course.id);
    }).catch((reason: unknown) => setError(errorMessage(reason))), 500);
    return () => window.clearInterval(timer);
  }, [authoringJob?.id, authoringJob?.status]);

  useEffect(() => {
    if (!authoringJob?.course) return;
    setTargetLevel(authoringJob.course.targetLevel);
    setLearningGoals(authoringJob.course.learningGoals.map((goal) => goal.description).join("\n"));
  }, [authoringJob?.course]);

  useEffect(() => {
    void fetchJson<{ settings: LlmSettingsView }>("/api/settings/llm").then(({ settings }) => {
      setLlmSettings(settings); setLlmModel(settings.model); setLlmBaseUrl(settings.baseUrl);
    }).catch((reason: unknown) => setError(errorMessage(reason)));
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

  async function saveLlmSettings() {
    setBusy(true); setError(null);
    try {
      const result = await fetchJson<{ settings: LlmSettingsView }>("/api/settings/llm", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(llmKey ? { apiKey: llmKey } : {}), model: llmModel, baseUrl: llmBaseUrl }) });
      setLlmSettings(result.settings); setLlmKey("");
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }

  async function refreshCourses(preferredId?: string) {
    const result = await fetchJson<{ courses: CourseSummary[] }>("/api/courses"); setCourses(result.courses);
    if (preferredId) { setCourseId(preferredId); const course = result.courses.find((item) => item.id === preferredId); if (course) setDuration(course.durationMinutes); }
  }

  async function startAuthoring() {
    setBusy(true); setError(null);
    try {
      const sources: AuthoringSourceUpload[] = await Promise.all(sourceFiles.map(async (file) => ({ fileName: file.name, mimeType: supportedMimeType(file), dataBase64: await fileBase64(file), rights: { basis: sourceRights } })));
      if (sourceNote.trim()) sources.push({ fileName: "instructor-note.txt", mimeType: "text/plain", dataBase64: utf8Base64(sourceNote.trim()), rights: { basis: sourceRights } });
      const result = await fetchJson<{ job: AuthoringJobView }>("/api/authoring/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ durationMinutes: duration, sources, ...(targetLevel.trim() ? { targetLevel: targetLevel.trim() } : {}), ...(learningGoals.trim() ? { learningGoals: learningGoals.split("\n").map((value) => value.trim()).filter(Boolean) } : {}) }) });
      setAuthoringJob(result.job);
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }

  async function continueAuthoring(action: "resume" | "restart") {
    if (!authoringJob) return;
    setBusy(true); setError(null);
    try { const result = await fetchJson<{ job: AuthoringJobView }>(`/api/authoring/jobs/${encodeURIComponent(authoringJob.id)}/${action}`, { method: "POST", ...(action === "resume" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ additionalTimeBudgetMs: 300_000, additionalCostBudgetUsd: 2 }) } : {}) }); setAuthoringJob(result.job); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
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
          <details className="llm-settings">
            <summary><span>LLM接続</span><b>{llmSettings?.model ? `${llmSettings.model} · ${llmSettings.apiKeyConfigured || isLocalLlmUrl(llmSettings.baseUrl) ? "設定済み" : "要確認"}` : "未設定"}</b></summary>
            <div className="llm-fields">
              <label>APIキー<input type="password" autoComplete="new-password" value={llmKey} onChange={(event) => setLlmKey(event.target.value)} placeholder={llmSettings?.apiKeyConfigured ? "設定済み（変更時だけ入力）" : "APIキー"} /></label>
              <label>モデル<input value={llmModel} onChange={(event) => setLlmModel(event.target.value)} placeholder="モデル名" /></label>
              <details><summary>詳細設定</summary><label>Base URL<input value={llmBaseUrl} onChange={(event) => setLlmBaseUrl(event.target.value)} placeholder="通常は空欄" /></label></details>
              <button type="button" disabled={busy || !llmModel.trim()} onClick={() => void saveLlmSettings()}>接続設定を保存</button>
            </div>
          </details>
          <details className="authoring-settings">
            <summary><span>教材を作成・取り込む</span><b>{authoringJob ? authoringStatus(authoringJob.status) : "授業前に実行"}</b></summary>
            <div className="authoring-fields">
              <label>教材ファイル（PDF・画像・Markdown）<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.md,.txt,application/pdf,image/png,image/jpeg,image/webp,text/markdown,text/plain" onChange={(event) => setSourceFiles([...event.target.files ?? []])} /></label>
              <label>任意ノート<textarea value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} placeholder="ファイルに加えたい指示や教材本文" /></label>
              <label>利用権<select value={sourceRights} onChange={(event) => setSourceRights(event.target.value as typeof sourceRights)}><option value="owned">自分が権利を保有</option><option value="licensed">ライセンス済み</option><option value="public-domain">パブリックドメイン</option><option value="permission">利用許可あり</option></select></label>
              <details><summary>推定結果を指定・修正する</summary><label>対象レベル<input value={targetLevel} onChange={(event) => setTargetLevel(event.target.value)} placeholder="空欄なら自動推定" /></label><label>学習目標（1行に1件）<textarea value={learningGoals} onChange={(event) => setLearningGoals(event.target.value)} placeholder="空欄なら自動推定" /></label></details>
              <button type="button" disabled={busy || (sourceFiles.length === 0 && !sourceNote.trim())} onClick={() => void startAuthoring()}>自動作成と審査を開始</button>
              {authoringJob && <AuthoringResult job={authoringJob} onContinue={continueAuthoring} busy={busy} />}
            </div>
          </details>
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

function AuthoringResult({ job, onContinue, busy }: { job: AuthoringJobView; onContinue(action: "resume" | "restart"): Promise<void>; busy: boolean }) {
  return <section className={`authoring-result authoring-result--${job.status}`} aria-live="polite"><div><strong>{authoringStatus(job.status)}</strong><span>{job.attempts}回試行 · {job.sourceCount}資料</span></div>{job.course && <><h3>{job.course.title}</h3><p>{job.course.targetLevel} · {job.course.durationMinutes}分</p><ul>{job.course.learningGoals.map((goal) => <li key={goal.id}>{goal.description}</li>)}</ul></>}{job.review && <details><summary>審査結果 {job.review.gates.filter((gate) => gate.passed).length}/9</summary><ul>{job.review.gates.map((gate) => <li key={gate.id} className={gate.passed ? "passed" : "failed"}><b>{gate.passed ? "合格" : "不合格"}</b> {gateLabels[gate.id]}: {gate.rationale}{!gate.passed && gate.locations.length > 0 && <small>箇所: {gate.locations.join(", ")}</small>}{!gate.passed && gate.repairInstruction && <small>修正: {gate.repairInstruction}</small>}</li>)}</ul></details>}{job.error && <p>{job.error}</p>}{(job.status === "budget-exhausted" || job.status === "failed") && <div className="authoring-actions"><button type="button" disabled={busy} onClick={() => void onContinue("resume")}>checkpointから再開</button><button type="button" disabled={busy} onClick={() => void onContinue("restart")}>最初から作り直す</button></div>}</section>;
}

function authoringStatus(status: AuthoringJobView["status"]) { return status === "running" ? "自動作成・審査中" : status === "available" ? "講義に利用可能" : status === "budget-exhausted" ? "上限で一時停止" : "作成失敗"; }
function isLocalLlmUrl(value: string) { return /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value); }
function supportedMimeType(file: File): AuthoringSourceUpload["mimeType"] { const byExtension: Record<string, AuthoringSourceUpload["mimeType"]> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", md: "text/markdown", txt: "text/plain" }; const value = (file.type || byExtension[file.name.split(".").at(-1)?.toLowerCase() ?? ""]) as AuthoringSourceUpload["mimeType"] | undefined; if (!value || !Object.values(byExtension).includes(value)) throw new TypeError(`${file.name} は対応していない形式です。`); return value; }
async function fileBase64(file: File): Promise<string> { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }
function utf8Base64(value: string): string { return fileBytesBase64(new TextEncoder().encode(value)); }
function fileBytesBase64(bytes: Uint8Array): string { let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }

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
