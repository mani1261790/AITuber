import { pdfPageImages } from "./pdf-page-images.ts";
import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { AuthoringJobView, AuthoringSourceUpload, ClassroomRoomView, CourseSummary, FixedSessionView, LlmSettingsView, SessionCommandRequest } from "@aituber/contracts";
import "./styles.css";

declare const __AITUBER_CLASSROOM_ORIGIN__: string;
const sessionLabels: Record<FixedSessionView["status"], string> = { PREPARING: "準備中", TEACHING: "講義中", CHECKPOINT: "確認問題", PAUSED: "一時停止中", RECOVERING: "再開中", FINISHED: "終了" };
const gateLabels = { "source-alignment": "出典と内容", "factual-consistency": "事実・式・数値", "goal-alignment": "学習目標", prerequisites: "前提関係", references: "参照ID", renderability: "描画可能性", "speech-caption": "発話と字幕", "safe-content": "安全な内容", rights: "利用権" };
type Scope = "authoring" | "session" | "connection";
type Confirmation = { title: string; description: string; label: string; run(): void };

type Page = "lecture" | "materials" | "new" | "connection";
function currentPage(): Page { const page = window.location.hash.replace("#/", ""); return page === "materials" || page === "new" || page === "connection" ? page : "lecture"; }
function OperatorApp() {
  const [page, setPage] = useState<Page>(currentPage);
  useEffect(() => { const change = () => {setPage(currentPage()); window.scrollTo(0, 0);}; window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [courseId, setCourseId] = useState("");
  const [duration, setDuration] = useState(6);
  const [authoringDuration, setAuthoringDuration] = useState(15);
  const [session, setSession] = useState<FixedSessionView | null>(null);
  const [classroom, setClassroom] = useState<ClassroomRoomView | null>(null);
  const [classroomOrigin, setClassroomOrigin] = useState(__AITUBER_CLASSROOM_ORIGIN__);
  const [jobs, setJobs] = useState<AuthoringJobView[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [settings, setSettings] = useState<LlmSettingsView | null>(null);
  const [llmKey, setLlmKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [sourceNote, setSourceNote] = useState("");
  const [sourceRights, setSourceRights] = useState<AuthoringSourceUpload["rights"]["basis"] | "">("");
  const [targetLevel, setTargetLevel] = useState("");
  const [learningGoals, setLearningGoals] = useState("");
  const [timeBudget, setTimeBudget] = useState(15);
  const [costBudget, setCostBudget] = useState(2);
  const [uploadProgress, setUploadProgress] = useState("");
  const [busy, setBusy] = useState<Partial<Record<Scope, boolean>>>({});
  const locks = useRef(new Set<Scope>());
  const revision = useRef(0);
  const seededSettings = useRef(false);
  const seededCourse = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const activeJob = jobs.find(job => job.status === "running");
  const job = jobs.find(item => item.id === selectedJobId) ?? activeJob ?? jobs[0];
  const activeSession = Boolean(session && session.status !== "FINISHED");
  const connected = Boolean(settings && (settings.chatgpt ? settings.chatgpt.status === "connected" : settings.apiKeyConfigured || isLocalLlmUrl(settings.baseUrl)));
  const selectedCourse = courses.find(course => course.id === courseId);

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<{ classroomOrigin: string }>("/aituber-runtime-config.json", {signal: controller.signal}).then(config => setClassroomOrigin(config.classroomOrigin)).catch(() => undefined);
    if (new URLSearchParams(window.location.search).get("chatgpt") === "failed") setError("ChatGPT認証を完了できませんでした。接続設定から状態を確認してください。");
    return () => controller.abort();
  }, []);

  // Serial polling prevents slow responses from overlapping; action revisions reject stale snapshots.
  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      const version = revision.current;
      try {
        const [courseResult, sessionResult, jobResult, settingsResult] = await Promise.all([
          fetchJson<{courses: CourseSummary[]}>("/api/courses", {signal: controller.signal}),
          fetchJson<{session: FixedSessionView | null; classroom: ClassroomRoomView | null}>("/api/sessions/current", {signal: controller.signal}),
          fetchJson<{jobs: AuthoringJobView[]}>("/api/authoring/jobs", {signal: controller.signal}),
          fetchJson<{settings: LlmSettingsView}>("/api/settings/llm", {signal: controller.signal}),
        ]);
        if (controller.signal.aborted || version !== revision.current || locks.current.size) return;
        setCourses(courseResult.courses);
        if (!seededCourse.current && courseResult.courses[0]) { seededCourse.current = true; setCourseId(courseResult.courses[0].id); setDuration(courseResult.courses[0].durationMinutes); }
        setSession(sessionResult.session); setClassroom(sessionResult.classroom); setJobs(jobResult.jobs); setSettings(settingsResult.settings);
        if (!seededSettings.current) { seededSettings.current = true; setLlmModel(settingsResult.settings.model); setLlmBaseUrl(settingsResult.settings.baseUrl); }
        setLoaded(true); setLastSync(new Date()); setSyncError(null);
      } catch (reason) { if (!controller.signal.aborted && version === revision.current && !locks.current.size) setSyncError(errorMessage(reason)); }
      finally { if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 3000); }
    }
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [refresh]);

  async function perform(scope: Scope, action: () => Promise<void>) {
    if (locks.current.has(scope)) return;
    locks.current.add(scope); revision.current++; setBusy(value => ({...value, [scope]: true})); setError(null); setNotice(null);
    try { await action(); } catch (reason) { setError(errorMessage(reason)); }
    finally { locks.current.delete(scope); revision.current++; setBusy(value => ({...value, [scope]: false})); setRefresh(value => value + 1); }
  }
  function updateJob(next: AuthoringJobView) { setJobs(values => [next, ...values.filter(value => value.id !== next.id)]); setSelectedJobId(next.id); }
  async function controlJob(action: "stop" | "resume" | "restart") {
    if (!job) return;
    await perform("authoring", async () => {
      const {job: next} = await fetchJson<{job: AuthoringJobView}>(`/api/authoring/jobs/${encodeURIComponent(job.id)}/${action}`, post(action === "resume" ? { additionalTimeBudgetMs: 300_000, additionalCostBudgetUsd: 2 } : undefined));
      updateJob(next); setNotice(action === "stop" ? "教材作成を停止しました。元資料と途中結果は保存されています。" : "教材作成を開始しました。");
    });
  }
  async function startAuthoring() {
    if (activeJob || !connected) return;
    await perform("authoring", async () => {
      if (!sourceRights) throw new Error("資料の利用権を選択してください。");
      if (!validDuration(authoringDuration) || !Number.isInteger(timeBudget) || timeBudget < 1 || timeBudget > 60 || !Number.isFinite(costBudget) || costBudget <= 0) throw new Error("講義時間・処理時間・費用上限を確認してください。");
      if (sourceFiles.length + Number(Boolean(sourceNote.trim())) > 16) throw new Error("資料はノートを含めて16件までです。");
      let bytes = new TextEncoder().encode(sourceNote.trim()).length;
      for (const file of sourceFiles) {
        const type = supportedMimeType(file);
        if (!file.size || file.size > (type.startsWith("image/") ? 10 : 20) * 1024 * 1024) throw new Error(`${file.name}: 空のファイル、またはサイズ上限超過です。画像10 MiB・その他20 MiBまでです。`);
        bytes += file.size;
      }
      if (bytes > 24 * 1024 * 1024) throw new Error("資料の合計は24 MiBまでです。");
      const sources: AuthoringSourceUpload[] = [];
      for (const [index, file] of sourceFiles.entries()) {
        setUploadProgress(`資料を準備中 ${index + 1}/${sourceFiles.length} · ${file.name}`);
        const mimeType = supportedMimeType(file);
        const pageImages = mimeType === "application/pdf" ? await pdfPageImages(file) : undefined;
        if (pageImages) bytes += pageImages.reduce((total, image) => total + atob(image.dataBase64).length, 0);
        if (bytes > 24 * 1024 * 1024) throw new Error("PDFのページ画像を含めると24 MiBを超えます。PDFを分割して登録してください。");
        sources.push({ fileName: file.name, mimeType, dataBase64: await fileBase64(file), ...(pageImages ? {pageImages} : {}), rights: {basis: sourceRights} });
      }
      if (sourceNote.trim()) sources.push({fileName: "instructor-note.txt", mimeType: "text/plain", dataBase64: fileBytesBase64(new TextEncoder().encode(sourceNote.trim())), rights: {basis: sourceRights}});
      setUploadProgress("資料を送信中…");
      const result = await fetchJson<{job: AuthoringJobView}>("/api/authoring/jobs", post({ durationMinutes: authoringDuration, sources, timeBudgetMs: timeBudget * 60_000, costBudgetUsd: costBudget, ...(targetLevel.trim() ? {targetLevel: targetLevel.trim()} : {}), ...(learningGoals.trim() ? {learningGoals: learningGoals.split("\n").map(value => value.trim()).filter(Boolean)} : {}) }));
      updateJob(result.job); window.location.hash = "/materials"; setNotice("教材作成を開始しました。処理状況からいつでも停止できます。");
    });
    setUploadProgress("");
  }
  async function command(command: SessionCommandRequest["command"]) {
    if (!session) return;
    await perform("session", async () => {
      const result = await fetchJson<{session: FixedSessionView; classroom: ClassroomRoomView}>(`/api/sessions/${encodeURIComponent(session.id)}/commands`, post({command}));
      setSession(result.session); setClassroom(result.classroom);
    });
  }
  async function startLecture() {
    if (activeSession || !connected || !validDuration(duration)) return;
    await perform("session", async () => {
      const result = await fetchJson<{session: FixedSessionView; classroom: ClassroomRoomView}>("/api/sessions", post({coursePackageId: courseId, durationMinutes: duration}));
      setSession(result.session); setClassroom(result.classroom); setNotice("講義を開始しました。進行パネルから一時停止できます。");
    });
  }
  async function connectionAction(action: "check" | "disconnect" | "connect" | "save") {
    await perform("connection", async () => {
      if (action === "connect") { const result = await fetchJson<{url: string}>("/api/settings/llm/chatgpt/start", post()); window.location.assign(result.url); return; }
      const result = action === "save"
        ? await fetchJson<{settings: LlmSettingsView}>("/api/settings/llm", {...post({...(llmKey ? {apiKey: llmKey} : {}), model: llmModel, baseUrl: llmBaseUrl}), method: "PUT"})
        : await fetchJson<{settings: LlmSettingsView}>(`/api/settings/llm/chatgpt/${action}`, post());
      setSettings(result.settings); setLlmKey("");
      setNotice(action === "disconnect" ? "ChatGPTから切断しました。" : action === "check" ? "接続テストの文章生成が完了しました。" : "接続設定を保存しました。");
      if ("revoked" in result && result.revoked === false) setError("AITuberから切断しましたが、OpenAI側の解除を確認できません。ChatGPTの利用状況で接続を確認してください。");
    });
  }

  return <div className="app-layout">
    <aside className="sidebar"><a className="brand" href="#/lecture">講義管理</a><nav aria-label="管理メニュー">{([['lecture', '講義'], ['materials', '教材'], ['connection', '接続設定']] as const).map(([target, label]) => <a key={target} href={`#/${target}`} aria-current={(page === target || target === "materials" && page === "new") ? "page" : undefined}>{label}</a>)}</nav><p className="sidebar-note">{connected ? "AI 接続済み" : "AI 未接続"}</p></aside>
    <main className="workspace">
      <header className="page-header"><div><h1>{({lecture: "講義", materials: "教材", new: "教材を作成", connection: "接続設定"})[page]}</h1><p className="muted">{({lecture: "講義の状態を確認して、開始・一時停止・終了を操作できます。", materials: "使える教材と、作成中・停止中の処理を確認できます。", new: "資料と作成条件を指定してください。", connection: "教材作成と講義に使用するAIの接続を管理します。"})[page]}</p></div><div className="sync-state">{syncError ? "更新できていません" : loaded ? "自動更新中" : "読み込み中"}{lastSync && <span>最終確認 {lastSync.toLocaleTimeString("ja-JP", {hour: "2-digit", minute: "2-digit"})}</span>}<button className="text-button" onClick={() => setRefresh(value => value + 1)}>再取得</button></div></header>
      {syncError && <div className="message warning" role="alert"><strong>状態を確認できません</strong><p>{syncError} 接続が戻るまで、表示は前回取得時の状態です。</p></div>}
      {error && <div className="message danger" role="alert"><strong>操作を完了できませんでした</strong><p>{error}</p><button className="text-button" onClick={() => setError(null)}>閉じる</button></div>}
      {notice && <div className="message success" role="status">{notice}</div>}
      {activeJob && page !== "materials" && <div className="message warning">教材を作成しています。画面を閉じても処理は続きます。<a href="#/materials" onClick={() => setSelectedJobId(activeJob.id)}>処理の確認・停止</a></div>}
      {page === "lecture" && session && <>
      <section className={`card live-panel ${activeSession ? "is-live" : ""}`} aria-labelledby="live-heading"><SectionTitle title="講義の進行" id="live-heading" subtitle="一時停止すると、続きから再開できます。" />
        {session ? <><div className="live-body"><div><Badge tone={activeSession ? "green" : "neutral"}>{sessionLabels[session.status]}</Badge><h3>{session.course.title}</h3><p className="muted">説明済み {session.progress.completed} / {session.progress.total}</p><progress value={session.progress.completed} max={session.progress.total || 1} aria-label="講義の進行" />{session.speech.mode === "caption-fallback" && <p className="inline-warning">音声合成に失敗したため、字幕で進行しています。</p>}</div>{classroom && <div className="room-card"><span className="room-label">教室コード</span><strong>{classroom.code}</strong><p>{classroom.participantCount} / {classroom.capacity} 人が参加</p><a href={`${classroomOrigin}/?code=${encodeURIComponent(classroom.code)}`} target="_blank" rel="noreferrer">教室画面を開く</a></div>}</div>{activeSession && <div className="live-controls"><button className="primary" disabled={busy.session || session.status === "RECOVERING" || (session.status === "PAUSED" && (!connected || Boolean(syncError)))} onClick={() => void command(session.status === "PAUSED" ? "resume" : "pause")}>{busy.session ? "操作中…" : session.status === "PAUSED" ? "講義を再開" : "講義を一時停止"}</button><button className="danger-outline" disabled={busy.session} onClick={() => setConfirmation({title: "この講義を終了しますか？", description: "参加者への講義を終了します。この講義の続きからの再開はできません。一時的に止める場合は「一時停止」を使ってください。", label: "講義を終了する", run: () => void command("finish")})}>講義を終了</button><span className="muted">{session.status === "PAUSED" && !connected ? "再開するにはAI接続が必要です。" : "一時停止後は、続きから再開できます。"}</span></div>}{!activeSession && <p className="muted">完了 {session.completedUnitIds.length} 項目 · 未完了 {session.unfinishedUnitIds.length} 項目</p>}</> : <div className="empty-state"><div><h3>まだ講義は始まっていません</h3><p>利用する教材と時間を確認してから、講義を開始できます。</p></div></div>}
      </section>
      </>}
      {page === "materials" && <>
        <div className="page-actions"><a className="button primary" href="#/new">新しい教材を作成</a></div>

        <section className="card" aria-labelledby="materials-heading"><SectionTitle title="作成状況と履歴" id="materials-heading" subtitle="停止した処理も、元資料と途中結果が保存されています。" />
          {!job && <p>教材の作成履歴はありません。</p>}
          {jobs.length > 1 && <label className="field history-field">作成履歴<select value={job?.id ?? ""} disabled={busy.authoring} onChange={event => setSelectedJobId(event.target.value)}>{jobs.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString("ja-JP")} · {authoringStatus(item.status)} · {item.course?.title ?? `${item.sourceCount}資料`}</option>)}</select></label>}
          {job && <AuthoringResult job={job} busy={Boolean(busy.authoring)} canResume={connected && !activeJob && !syncError} onAction={action => action === "stop" ? void controlJob(action) : setConfirmation({title: action === "restart" ? "最初から作り直しますか？" : "教材作成を再開しますか？", description: action === "restart" ? "途中の生成結果を破棄し、保存済みの元資料から作り直します。AIを再度利用します。" : "保存済みの資料・途中結果を使います。処理時間を5分、概算費用の上限を$2追加し、最大5回試行します。", label: action === "restart" ? "作り直す" : "上限を追加して再開", run: () => void controlJob(action)})} />}

          {activeJob && activeJob.id !== job?.id && <div className="message warning">別の教材を作成中です。<button className="text-button" onClick={() => setSelectedJobId(activeJob.id)}>実行中の処理を表示</button></div>}
        </section>
        <section className="card"><h2>利用できる教材</h2>{courses.length ? <ul className="course-list">{courses.map(course => <li key={course.id}><div><h3>{course.title}</h3><p className="muted">{course.targetLevel} · {course.durationMinutes}分</p></div><a href="#/lecture" onClick={() => {setCourseId(course.id); setDuration(course.durationMinutes);}}>{activeSession ? "進行中の講義を見る" : "この教材で講義を準備"}</a></li>)}</ul> : <p>利用できる教材はまだありません。資料から教材を作成してください。</p>}</section>
      </>}
      {page === "new" && <section className="card creation-form"><a href="#/materials">教材一覧に戻る</a><h2>資料と作成条件</h2><fieldset disabled={busy.authoring || Boolean(activeJob)}>
            <label className="upload-zone"><strong>教材ファイルを選択</strong><span>PDF・画像・Markdown・テキスト</span><input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.md,.txt" onChange={event => setSourceFiles([...event.target.files ?? []])} /></label>
            {sourceFiles.length > 0 && <ul className="file-list">{sourceFiles.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}<small>{(file.size / 1024 / 1024).toFixed(1)} MiB</small></span><button className="text-button" onClick={() => setSourceFiles(files => files.filter((_, i) => i !== index))} aria-label={`${file.name}を取り除く`}>削除</button></li>)}</ul>}
            <p className="help">最大16資料。画像は各10 MiB、その他は各20 MiB。PDFのページ画像を含め合計24 MiBまで。</p>
            <label className="field">教材本文・補足ノート<textarea value={sourceNote} onChange={event => setSourceNote(event.target.value)} placeholder="テキストだけでも作成できます。" rows={3} /></label>
            <label className="field">資料の利用権 <span className="required">必須</span><select value={sourceRights} onChange={event => setSourceRights(event.target.value as typeof sourceRights)}><option value="">確認して選択してください</option><option value="owned">自分が権利を保有</option><option value="licensed">ライセンス済み</option><option value="public-domain">パブリックドメイン</option><option value="permission">利用許可あり</option></select></label>
            <div className="form-row"><label className="field">作成する講義の時間<NumberField value={authoringDuration} onChange={setAuthoringDuration} min={1} max={480} unit="分" /></label><label className="field">対象レベル<input value={targetLevel} onChange={event => setTargetLevel(event.target.value)} placeholder="例：高校1年生（空欄で推定）" /></label></div>
            <label className="field">学習目標 <span className="optional">任意・1行に1件</span><textarea value={learningGoals} onChange={event => setLearningGoals(event.target.value)} placeholder="この講義で理解してほしいこと" rows={2} /></label>
            <div className="budget-box"><strong>自動処理の上限</strong><div className="form-row"><label className="field">処理時間<NumberField value={timeBudget} onChange={setTimeBudget} min={1} max={60} unit="分" /></label><label className="field">概算費用<NumberField value={costBudget} onChange={setCostBudget} min={0.01} step={0.5} unit="USD" /></label></div><p>最大5回まで試行。同じ問題が3回続くと停止します。</p><p className="help">費用は取得できた利用情報からの概算です。ChatGPTプランの残量や実際の請求額を示すものではありません。</p></div>
            {!connected && <p className="inline-warning">作成にはAI接続が必要です。<a href="#/connection">接続設定へ</a></p>}
            {activeJob && <p className="inline-warning">実行中の教材作成を停止または完了してから、新しく作成できます。</p>}
            <button className="primary full" disabled={!loaded || Boolean(syncError) || !connected || !sourceRights || !validDuration(authoringDuration) || !Number.isInteger(timeBudget) || timeBudget < 1 || timeBudget > 60 || !Number.isFinite(costBudget) || costBudget <= 0 || (!sourceFiles.length && !sourceNote.trim())} onClick={() => void startAuthoring()}>{busy.authoring ? "準備中…" : "この条件で作成を開始"}</button>
          </fieldset>{uploadProgress && <p role="status">{uploadProgress}</p>}</section>}
        {page === "lecture" && !activeSession && <section className="card" id="prepare" aria-labelledby="prepare-heading"><SectionTitle title="講義を準備する" id="prepare-heading" subtitle="利用可能な教材から選択します。" />
          <label className="field">使用する教材<select value={courseId} disabled={!courses.length || activeSession || busy.session} onChange={event => {setCourseId(event.target.value); const next = courses.find(item => item.id === event.target.value); if (next) setDuration(next.durationMinutes);}}>{!courses.length && <option value="">教材がありません</option>}{courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
          {selectedCourse && <div className="course-preview"><Badge tone="green">利用可能</Badge><h3>{selectedCourse.title}</h3><p className="muted">{selectedCourse.targetLevel} · 標準 {selectedCourse.durationMinutes}分</p><strong>学習目標</strong><ul>{selectedCourse.learningGoals.map(goal => <li key={goal.id}>{goal.description}</li>)}</ul></div>}
          <label className="field">今回の講義時間<NumberField value={duration} onChange={setDuration} min={1} max={480} unit="分" disabled={activeSession || Boolean(busy.session)} /></label>
          <div className="readiness"><p>{selectedCourse ? "教材を選択済み" : "教材を選択してください"}</p><p>AI {connected ? "接続済み" : "未接続"}{!connected && <a href="#/connection">設定へ</a>}</p><p>{activeSession ? "進行中の講義を終了してください" : "他の講義は進行していません"}</p></div>
          <button className="primary full" disabled={!loaded || Boolean(syncError) || busy.session || !selectedCourse || !validDuration(duration) || !connected || activeSession} onClick={() => setConfirmation({title: "講義を開始しますか？", description: `「${selectedCourse?.title}」を${duration}分で開始します。開始後、AIと音声生成を利用して講義が進みます。`, label: "講義を開始する", run: () => void startLecture()})}>{busy.session ? "操作中…" : "講義を開始"}</button>
        </section>}
        {page === "connection" && <section className="card" id="connection" aria-labelledby="connection-heading"><SectionTitle title="AI 接続" id="connection-heading" subtitle="教材作成・講義で使う接続を管理します。" /><div className="connection-summary"><Badge tone={connected ? "green" : "amber"}>{connected ? "接続済み" : "未接続"}</Badge><strong>{settings?.chatgpt ? "ChatGPT · GPT-6 Luna" : settings?.model || "接続を設定してください"}</strong></div>
          {settings?.chatgpt ? <><p className="help">{settings.chatgpt.message}</p>{settings.chatgpt.email && <p className="account">{settings.chatgpt.email}</p>}{settings.chatgpt.status === "registration-required" || settings.chatgpt.status === "local-authorization-required" ? <div className="message warning"><p>Macのプロジェクトで認証し、この画面を再取得してください。</p><code>pnpm connect:chatgpt</code></div> : connected ? <><div className="button-row"><button disabled={busy.connection} onClick={() => void connectionAction("check")}>接続テスト</button><button className="text-button" disabled={busy.connection || Boolean(activeJob) || activeSession} onClick={() => setConfirmation({title: "ChatGPTから切断しますか？", description: "再接続するまで、新しい教材作成とAIを使う講義を開始できなくなります。", label: "接続を解除", run: () => void connectionAction("disconnect")})}>切断</button></div><p className="help">接続テストは短い文章を生成します。切断するには、先に教材作成を停止し、講義を終了してください。</p></> : <button className="primary full" disabled={busy.connection} onClick={() => void connectionAction("connect")}>ChatGPTに接続</button>}<a className="external-link" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">ChatGPTの利用状況</a></> : <details className="settings-details"><summary>接続設定を編集</summary><fieldset disabled={busy.connection || Boolean(activeJob) || activeSession}><label className="field">APIキー<input type="password" autoComplete="new-password" value={llmKey} onChange={event => setLlmKey(event.target.value)} placeholder={settings?.apiKeyConfigured ? "変更する場合だけ入力" : "APIキー"} /></label><label className="field">モデル<input value={llmModel} onChange={event => setLlmModel(event.target.value)} /></label><label className="field">Base URL<input value={llmBaseUrl} onChange={event => setLlmBaseUrl(event.target.value)} placeholder="通常は空欄" /></label><button disabled={!llmModel.trim()} onClick={() => void connectionAction("save")}>接続設定を保存</button></fieldset></details>}
        </section>}<footer>作成・進行の停止は、それぞれの操作パネルから行えます。画面を閉じてもサーバー上の処理は続きます。</footer>
    </main>{confirmation && <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />}
  </div>;
}

function AuthoringResult({job, busy, canResume, onAction}: {job: AuthoringJobView; busy: boolean; canResume: boolean; onAction(action: "stop" | "resume" | "restart"): void}) {
  const gates = job.review?.gates ?? [];
  const reviewed = gates.filter(gate => gate.evaluated !== false);
  const passed = reviewed.filter(gate => gate.passed).length;
  const failed = reviewed.filter(gate => !gate.passed);
  const running = job.status === "running";
  return <div className="job-panel"><div className="job-header"><Badge tone={running ? "blue" : job.status === "available" ? "green" : "amber"}>{authoringStatus(job.status)}</Badge>{running && <button className="danger-outline" disabled={busy} onClick={() => onAction("stop")}>{busy ? "停止中…" : "作成を停止"}</button>}</div>
    <h3>{job.course?.title ?? `${job.sourceCount}資料から教材を作成`}</h3><div className="job-metrics"><div><span>試行</span><strong>{job.attempts}<small>{job.attemptLimit === undefined ? "回" : ` / ${job.attemptLimit}回`}</small></strong></div><div><span>処理時間</span><strong>{Math.floor(job.elapsedMs / 60_000)}<small> / {Math.round(job.request.timeBudgetMs / 60_000)}分</small></strong></div><div><span>記録された概算費用</span><strong>${job.estimatedCostUsd.toFixed(3)}</strong></div></div>
    {running && <p className="help" role="status">自動作成・審査を進めています。停止すると元資料と途中結果を保存します。</p>}{job.error && <p className="inline-warning">{job.error}</p>}
    {job.review && <><div className="review-summary"><strong>{running ? "直前の審査結果" : "審査状況"}</strong><span>{passed} 合格 · {failed.length} 不合格 · {9 - reviewed.length} 未実施</span></div>{reviewed.length < 9 && <p className="help">形式の問題があるため、内容の審査は完了していません。</p>}<details className="review-details"><summary>審査の内訳を見る</summary><ul>{gates.map(gate => {const pending = gate.evaluated === false; return <li key={gate.id}><div><span>{gateLabels[gate.id]}</span><Badge tone={pending ? "neutral" : gate.passed ? "green" : "amber"}>{pending ? "未実施" : gate.passed ? "合格" : "不合格"}</Badge></div>{!pending && !gate.passed && <details><summary>問題の詳細</summary><p>{gate.rationale}</p>{gate.locations.length > 0 && <p>箇所: {gate.locations.join(", ")}</p>}</details>}</li>;})}</ul></details></>}
    {!running && job.status !== "available" && <div className="job-recovery"><p className="help">再開は途中結果を保持します。作り直しは途中結果を破棄します。どちらもAIを再度利用します。</p><div className="button-row"><button disabled={busy || !canResume} onClick={() => onAction("resume")}>途中から再開</button><button className="text-button" disabled={busy || !canResume} onClick={() => onAction("restart")}>最初から作り直す</button></div>{!canResume && <p className="help">接続状態と、他の教材が作成中でないことを確認してください。</p>}</div>}
  </div>;
}
function SectionTitle({title, subtitle, id}: {title: string; subtitle: string; id: string}) { return <div className="section-title"><h2 id={id}>{title}</h2><p>{subtitle}</p></div>; }
function Badge({tone, children}: {tone: "neutral" | "green" | "amber" | "blue"; children: ReactNode}) {return <span className={`badge badge--${tone}`}>{children}</span>;}
function NumberField({value, onChange, min, max, step, unit, disabled}: {value: number; onChange(value: number): void; min: number; max?: number; step?: number; unit: string; disabled?: boolean}) {return <span className="number-field"><input type="number" value={Number.isNaN(value) ? "" : value} min={min} max={max} step={step ?? 1} disabled={disabled} onChange={event => onChange(event.target.valueAsNumber)} /><span>{unit}</span></span>;}
function ConfirmDialog({confirmation, onClose}: {confirmation: Confirmation; onClose(): void}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {const dialog = ref.current; dialog?.showModal(); return () => dialog?.close();}, []);
  return <dialog ref={ref} aria-labelledby="confirm-title" aria-describedby="confirm-description" onCancel={onClose}><h2 id="confirm-title">{confirmation.title}</h2><p id="confirm-description">{confirmation.description}</p><div className="button-row"><button autoFocus onClick={onClose}>戻る</button><button className="primary" onClick={() => {onClose(); confirmation.run();}}>{confirmation.label}</button></div></dialog>;
}
function authoringStatus(status: AuthoringJobView["status"]) {return {running: "作成・審査中", stopped: "作成停止", available: "利用可能", "budget-exhausted": "上限で停止", failed: "作成失敗"}[status];}
function validDuration(value: number) {return Number.isInteger(value) && value >= 1 && value <= 480;}
function isLocalLlmUrl(value: string) {return /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value);}
function post(body?: unknown): RequestInit {return {method: "POST", ...(body === undefined ? {} : {headers: {"content-type": "application/json"}, body: JSON.stringify(body)})};}
function supportedMimeType(file: File): AuthoringSourceUpload["mimeType"] {
  const types: Record<string, AuthoringSourceUpload["mimeType"]> = {pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", md: "text/markdown", txt: "text/plain"};
  const type = (file.type || types[file.name.split(".").at(-1)?.toLowerCase() ?? ""]) as AuthoringSourceUpload["mimeType"] | undefined;
  if (!type || !Object.values(types).includes(type)) throw new Error(`${file.name} は対応していない形式です。`);
  return type;
}
async function fileBase64(file: File) {return fileBytesBase64(new Uint8Array(await file.arrayBuffer()));}
function fileBytesBase64(bytes: Uint8Array) {let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary);}
async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (response.status === 401 || response.redirected || !response.headers.get("content-type")?.includes("application/json")) throw new Error("管理画面へのログインを確認し、ページを再読み込みしてください。");
  const value = await response.json() as T & {message?: string};
  if (!response.ok) throw new Error(value.message ?? `操作に失敗しました（HTTP ${response.status}）`);
  return value;
}
function errorMessage(reason: unknown) {return reason instanceof Error ? reason.message : "処理に失敗しました。";}
const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Operator root element was not found");
createRoot(root).render(<StrictMode><OperatorApp /></StrictMode>);
