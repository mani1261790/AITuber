import { pdfPageImages } from "./pdf-page-images.ts";
import { StrictMode, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { AuthoringJobView, AuthoringSourceUpload, ClassroomRoomView, CourseSummary, FixedSessionView, LlmSettingsView, SessionCommandRequest } from "@aituber/contracts";
import "./styles.css";

declare const __AITUBER_CLASSROOM_ORIGIN__: string;
const sessionLabels: Record<FixedSessionView["status"], string> = { PREPARING: "教室の準備待ち", TEACHING: "講義中", CHECKPOINT: "確認問題", PAUSED: "一時停止中", RECOVERING: "再開中", FINISHED: "終了" };
const gateLabels = { "source-alignment": "出典と内容", "factual-consistency": "事実・式・数値", "goal-alignment": "学習目標", prerequisites: "前提関係", references: "参照ID", renderability: "描画可能性", "speech-caption": "発話と字幕", "safe-content": "安全な内容", rights: "利用権の申告" };
type Scope = "authoring" | "session" | "connection";
type Confirmation = { title: string; description: string; label: string; run(): void };

type Page = "lecture" | "materials" | "history" | "new" | "connection";
function currentPage(): Page { const page = window.location.hash.replace("#/", ""); return page === "materials" || page === "history" || page === "new" || page === "connection" ? page : "lecture"; }
function OperatorApp() {
  const [page, setPage] = useState<Page>(currentPage);
  useEffect(() => { const change = () => {setPage(currentPage()); setNotice(null); setError(null); window.scrollTo(0, 0);}; window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);
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
  const seededCourse = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signInHelp, setSignInHelp] = useState(false);
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
    let inFlight = false;
    let quotaStopped = false;
    async function poll() {
      if (inFlight || document.hidden || quotaStopped || controller.signal.aborted) return;
      inFlight = true;
      const version = revision.current;
      let retryDelay = 10000;
      try {
        const snapshot = await fetchJson<{courses: CourseSummary[]; session: FixedSessionView | null; classroom: ClassroomRoomView | null; jobs: AuthoringJobView[]; authoringFailure?: {id: string; message: string} | null; settings: LlmSettingsView}>("/api/operator/snapshot", {signal: controller.signal});
        if (controller.signal.aborted || version !== revision.current || locks.current.size) return;
        setCourses(snapshot.courses);
        if (!seededCourse.current && snapshot.courses[0]) { seededCourse.current = true; setCourseId(snapshot.courses[0].id); setDuration(snapshot.courses[0].durationMinutes); }
        if (snapshot.authoringFailure) setError(snapshot.authoringFailure.message);
        setSession(snapshot.session); setClassroom(snapshot.classroom); setJobs(snapshot.jobs); setSettings(snapshot.settings);
        setLoaded(true); setSyncError(null);
        retryDelay = snapshot.jobs.some(job => job.status === "running") || snapshot.session && !["PAUSED", "FINISHED"].includes(snapshot.session.status) ? 5000 : 30000;
      } catch (reason) { if (!controller.signal.aborted && version === revision.current && !locks.current.size) setSyncError(errorMessage(reason)); quotaStopped = reason instanceof ApiError && ["storage_quota_exceeded", "storage_safety_stop"].includes(reason.code ?? ""); retryDelay = quotaStopped ? 0 : 30000; }
      finally { inFlight = false; if (!controller.signal.aborted && retryDelay && !document.hidden) timer = window.setTimeout(() => void poll(), retryDelay); }
    }
    const visibility = () => { window.clearTimeout(timer); if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
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
      updateJob(result.job); window.location.hash = "/history"; setNotice("教材作成を開始しました。処理状況からいつでも停止できます。");
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
  async function connectionAction(action: "check" | "disconnect" | "connect") {
    await perform("connection", async () => {
      if (action === "connect") { const result = await fetchJson<{url: string}>("/api/settings/llm/chatgpt/start", post()); window.location.assign(result.url); return; }
      const result = await fetchJson<{settings: LlmSettingsView}>(`/api/settings/llm/chatgpt/${action}`, post());
      setSettings(result.settings);
      setNotice(action === "disconnect" ? "ChatGPTから切断しました。" : action === "check" ? "接続テストの文章生成が完了しました。" : "接続設定を保存しました。");
      if ("revoked" in result && result.revoked === false) setError("AITuberから切断しましたが、OpenAI側の解除を確認できません。ChatGPTの利用状況で接続を確認してください。");
    });
  }

  return <div className="app-layout">
    <aside className="sidebar"><a className="brand" href="#/lecture">講義管理</a><nav aria-label="管理メニュー">{([['lecture', '講義'], ['materials', '教材'], ['connection', '接続設定']] as const).map(([target, label]) => <a key={target} href={`#/${target}`} aria-current={(page === target || target === "materials" && (page === "new" || page === "history")) ? "page" : undefined}>{label}</a>)}</nav></aside>
    <main className="workspace">
      <header className="page-header"><h1><HeadingIcon kind={page} />{({lecture: "講義", materials: "教材", history: "教材の作成履歴", new: "教材を作成", connection: "接続設定"})[page]}</h1><div className="page-tools">{!loaded && <span role="status">読み込み中</span>}<button className="text-button" onClick={() => setRefresh(value => value + 1)}>更新</button></div></header>
      {(page === "materials" || page === "history") && <nav className="material-nav" aria-label="教材メニュー"><a href="#/materials" aria-current={page === "materials" ? "page" : undefined}>利用できる教材</a><a href="#/history" aria-current={page === "history" ? "page" : undefined}>作成履歴{activeJob ? "（作成中）" : ""}</a><a className="button primary" href="#/new">新しい教材を作成</a></nav>}

      {syncError && <div className="message warning" role="alert"><strong>状態を確認できません</strong><p>{syncError} 接続が戻るまで、表示は前回取得時の状態です。</p></div>}
      {error && <div className="message danger" role="alert"><strong>操作を完了できませんでした</strong><p>{error}</p><button className="text-button" onClick={() => setError(null)}>閉じる</button></div>}
      {notice && <div className="message success" role="status">{notice}</div>}
      {activeJob && page === "new" && <div className="message warning">別の教材を作成中です。<a href="#/history" onClick={() => setSelectedJobId(activeJob.id)}>処理の確認・停止</a></div>}
      {page === "lecture" && session && <>
      <section className={`card live-panel ${activeSession ? "is-live" : ""}`} aria-labelledby="live-heading"><SectionTitle title={activeSession ? "進行中の講義" : "前回の講義"} id="live-heading"  />
        {session ? <><div className="live-body"><div><Badge tone={activeSession ? "green" : "neutral"}>{sessionLabels[session.status]}</Badge><h3>{session.course.title}</h3><p className="muted">説明済み {session.progress.completed} / {session.progress.total}</p><progress value={session.progress.completed} max={session.progress.total || 1} aria-label="講義の進行" />{session.speech.mode === "caption-fallback" && <p className="inline-warning">音声合成に失敗したため、字幕で進行しています。</p>}</div>{classroom && <div className="room-card"><span className="room-label">教室コード</span><strong>{classroom.code}</strong><p>{classroom.participantCount} / {classroom.capacity} 人が参加</p><a href={`${classroomOrigin}/?code=${encodeURIComponent(classroom.code)}`} target="_blank" rel="noreferrer">教室画面を開く</a></div>}</div>{activeSession && <div className="live-controls"><button className="primary" disabled={busy.session || session.status === "RECOVERING" || (session.status === "PAUSED" && (!connected || Boolean(syncError)))} onClick={() => void command(session.status === "PAUSED" ? "resume" : "pause")}>{busy.session ? "操作中…" : session.status === "PAUSED" ? "講義を再開" : "講義を一時停止"}</button><button className="danger-outline" disabled={busy.session} onClick={() => setConfirmation({title: "この講義を終了しますか？", description: "参加者への講義を終了します。この講義の続きからの再開はできません。一時的に止める場合は「一時停止」を使ってください。", label: "講義を終了する", run: () => void command("finish")})}>講義を終了</button>{session.status === "PAUSED" && !connected && <a href="#/connection">再開にはAI接続が必要</a>}</div>}{!activeSession && <p className="muted">完了 {session.completedUnitIds.length} 項目 · 未完了 {session.unfinishedUnitIds.length} 項目</p>}</> : <div className="empty-state"><div><h3>まだ講義は始まっていません</h3><p>利用する教材と時間を確認してから、講義を開始できます。</p></div></div>}
      </section>
      </>}
      {page === "history" && <>
        <section className="card" aria-labelledby="materials-heading"><SectionTitle title="作成状況" id="materials-heading" />
          {!job && <p>教材の作成履歴はありません。</p>}
          {jobs.length > 1 && <SelectField label="作成履歴" value={job?.id ?? ""} disabled={Boolean(busy.authoring)} onChange={setSelectedJobId} options={jobs.map(item => ({value: item.id, label: `${new Date(item.createdAt).toLocaleString("ja-JP")} · ${authoringStatus(item.status)} · ${item.course?.title ?? `${item.sourceCount}資料`}`}))} />}
          {job && <AuthoringResult job={job} busy={Boolean(busy.authoring)} canResume={connected && !activeJob && !syncError} onAction={action => action === "stop" ? void controlJob(action) : setConfirmation({title: action === "restart" ? "最初から作り直しますか？" : "教材作成を再開しますか？", description: action === "restart" ? "途中の生成結果を破棄し、保存済みの元資料から作り直します。AIを再度利用します。" : "保存済みの資料・途中結果を使います。処理時間を5分、概算費用の上限を$2追加し、最大5回試行します。", label: action === "restart" ? "作り直す" : "上限を追加して再開", run: () => void controlJob(action)})} />}

          {activeJob && activeJob.id !== job?.id && <div className="message warning">別の教材を作成中です。<button className="text-button" onClick={() => setSelectedJobId(activeJob.id)}>実行中の処理を表示</button></div>}
        </section>
      </>}
      {page === "materials" && <>
        <section className="card" aria-label="利用できる教材">{activeSession && <p className="help"><a href="#/lecture">講義を終了</a>すると、次の教材を選べます。</p>}{courses.length ? <ul className="course-list">{courses.map(course => <li key={course.id}><div><h3>{course.title}</h3><p className="muted">{course.targetLevel} · {course.durationMinutes}分</p></div><div className="course-actions"><Disclosure title="学習目標">{course.learningGoals.map(goal => <p key={goal.id}>{goal.description}</p>)}</Disclosure>{!activeSession && <a href="#/lecture" onClick={() => {setCourseId(course.id); setDuration(course.durationMinutes);}}>この教材で講義を準備</a>}</div></li>)}</ul> : <p>利用できる教材はまだありません。資料から教材を作成してください。</p>}</section>
      </>}
      {page === "new" && <section className="card creation-form"><a href="#/materials">教材一覧に戻る</a><h2><HeadingIcon kind="new" />資料と作成条件</h2><fieldset disabled={busy.authoring || Boolean(activeJob)}>
            <div className="upload-zone"><strong>教材ファイル</strong><p>PDF・画像・Markdown・テキスト</p><label className="file-picker"><span className="button">ファイルを選ぶ</span><input aria-label="教材ファイルを選択" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.md,.txt" onChange={event => {setSourceFiles([...event.target.files ?? []]); event.target.value = "";}} /></label><p className="file-selection" role="status">{sourceFiles.length ? `${sourceFiles.length}件のファイルを選択中` : "ファイルは選択されていません"}</p></div>
            {sourceFiles.length > 0 && <ul className="file-list">{sourceFiles.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}<small>{(file.size / 1024 / 1024).toFixed(1)} MiB</small></span><button className="text-button" onClick={() => setSourceFiles(files => files.filter((_, i) => i !== index))} aria-label={`${file.name}を取り除く`}>削除</button></li>)}</ul>}
            <Disclosure title="ファイルの上限"><p>最大16資料。画像10 MiB・その他20 MiB／件。PDFのページ画像を含め計24 MiB。</p></Disclosure>
            <label className="field">教材本文・補足ノート<textarea value={sourceNote} onChange={event => setSourceNote(event.target.value)} placeholder="テキストだけでも作成できます。" rows={3} /></label>
            <SelectField label="資料の利用権（必須）" value={sourceRights} onChange={value => setSourceRights(value as typeof sourceRights)} options={[{value: "", label: "確認して選択してください"}, {value: "owned", label: "自分が権利を保有"}, {value: "licensed", label: "ライセンス済み"}, {value: "public-domain", label: "パブリックドメイン"}, {value: "permission", label: "利用許可あり"}]} />
            <div className="form-row"><label className="field">作成する講義の時間<NumberField value={authoringDuration} onChange={setAuthoringDuration} min={1} max={480} unit="分" /></label><label className="field">対象レベル<input value={targetLevel} onChange={event => setTargetLevel(event.target.value)} placeholder="例：高校1年生（空欄で推定）" /></label></div>
            <label className="field">学習目標 <span className="optional">任意・1行に1件</span><textarea value={learningGoals} onChange={event => setLearningGoals(event.target.value)} placeholder="この講義で理解してほしいこと" rows={2} /></label>
            <div className="budget-box"><strong>自動処理の上限</strong><div className="form-row"><label className="field">処理時間<NumberField value={timeBudget} onChange={setTimeBudget} min={1} max={60} unit="分" /></label><label className="field">概算費用<NumberField value={costBudget} onChange={setCostBudget} min={0.01} step={0.5} unit="USD" /></label></div><Disclosure title="停止条件・費用について"><p>最大5回試行。同じ問題が3回続くと停止します。</p><p>費用は記録された利用情報からの推定値です。実際の請求額やプラン残量とは異なります。</p></Disclosure></div>
            {!connected && <p className="inline-warning"><a href="#/connection">作成にはAI接続が必要</a></p>}

            <button className="primary full" disabled={!loaded || Boolean(syncError) || !connected || !sourceRights || !validDuration(authoringDuration) || !Number.isInteger(timeBudget) || timeBudget < 1 || timeBudget > 60 || !Number.isFinite(costBudget) || costBudget <= 0 || (!sourceFiles.length && !sourceNote.trim())} onClick={() => void startAuthoring()}>{busy.authoring ? "準備中…" : "この条件で作成を開始"}</button>
          </fieldset>{uploadProgress && <p role="status">{uploadProgress}</p>}</section>}
        {page === "lecture" && !activeSession && <section className="card" id="prepare" aria-labelledby="prepare-heading"><SectionTitle title="講義を準備する" id="prepare-heading"  />
          <SelectField label="使用する教材" value={courseId} disabled={!courses.length || activeSession || Boolean(busy.session)} onChange={value => {setCourseId(value); const next = courses.find(item => item.id === value); if (next) setDuration(next.durationMinutes);}} options={courses.map(course => ({value: course.id, label: course.title}))} />
          {selectedCourse && <div className="course-preview"><h3>{selectedCourse.title}</h3><p className="muted">{selectedCourse.targetLevel} · 標準 {selectedCourse.durationMinutes}分</p><strong>学習目標</strong><ul>{selectedCourse.learningGoals.map(goal => <li key={goal.id}>{goal.description}</li>)}</ul></div>}
          <label className="field">今回の講義時間<NumberField value={duration} onChange={setDuration} min={1} max={480} unit="分" disabled={activeSession || Boolean(busy.session)} /></label>
          {loaded && !connected && <p className="inline-warning"><a href="#/connection">開始にはAI接続が必要</a></p>}
          <button className="primary full" disabled={!loaded || Boolean(syncError) || busy.session || !selectedCourse || !validDuration(duration) || !connected || activeSession} onClick={() => setConfirmation({title: "講義を開始しますか？", description: `「${selectedCourse?.title}」を${duration}分で開始します。開始後、AIと音声生成を利用して講義が進みます。`, label: "講義を開始する", run: () => void startLecture()})}>{busy.session ? "操作中…" : "講義を開始"}</button>
        </section>}
        {page === "connection" && <section className="card" id="connection" aria-labelledby="connection-heading"><SectionTitle title="AI 接続" id="connection-heading"  />{settings?.chatgpt && <div className="connection-summary"><Badge tone={connected ? "green" : "amber"}>{connected ? "接続済み" : "未接続"}</Badge><strong>{settings?.chatgpt ? "ChatGPT · GPT-6 Luna" : settings?.model || "ChatGPT"}</strong></div>}
          {settings?.chatgpt ? <><Disclosure title="接続の詳細"><p>{settings.chatgpt.message}</p></Disclosure>{settings.chatgpt.email && <p className="account">{settings.chatgpt.email}</p>}{settings.chatgpt.status === "registration-required" || settings.chatgpt.status === "local-authorization-required" ? <><button className="primary full" onClick={() => setSignInHelp(true)}>ChatGPTでサインイン</button>{signInHelp && <LocalSignInDialog onClose={() => setSignInHelp(false)} />}</> : connected ? <><div className="button-row"><button disabled={busy.connection} onClick={() => void connectionAction("check")}>接続テスト（文章生成）</button><button className="text-button" disabled={busy.connection || Boolean(activeJob) || activeSession} onClick={() => setConfirmation({title: "ChatGPTから切断しますか？", description: "再接続するまで、新しい教材作成とAIを使う講義を開始できなくなります。", label: "接続を解除", run: () => void connectionAction("disconnect")})}>切断</button></div>{(activeJob || activeSession) && <p className="help">切断には教材作成と講義の終了が必要です。</p>}</> : <button className="primary full" disabled={busy.connection} onClick={() => void connectionAction("connect")}>ChatGPTでサインイン</button>}<a className="external-link" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">ChatGPTの利用状況</a></> : <p role="status">{syncError ? "接続情報を取得できません。復旧後に更新してください。" : "接続情報を読み込み中…"}</p>}
        </section>}
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
    <h3>{job.course?.title ?? `${job.sourceCount}資料から教材を作成`}</h3><div className="job-metrics"><div><span>試行</span><strong>{job.attempts}<small>{job.attemptLimit === undefined ? "回" : ` / ${job.attemptLimit}回`}</small></strong></div><div><span>処理時間</span><strong>{Math.floor(job.elapsedMs / 60_000)}<small> / {Math.round(job.request.timeBudgetMs / 60_000)}分</small></strong></div><div><span>概算費用</span><strong>${job.estimatedCostUsd.toFixed(3)}</strong></div></div>
    {job.error && job.status !== "stopped" && <p className="inline-warning">{job.error}</p>}
    {job.review && <><div className="review-summary"><strong>{running ? "直前の審査結果" : "審査状況"}</strong><span>{passed} 合格 · {failed.length} 不合格 · {9 - reviewed.length} 未実施</span></div><Disclosure className="review-details" title="審査の内訳を見る"><ul>{gates.map(gate => {const pending = gate.evaluated === false; return <li key={gate.id}><div><span>{gateLabels[gate.id]}</span><Badge tone={pending ? "neutral" : gate.passed ? "green" : "amber"}>{pending ? "未実施" : gate.passed ? "合格" : "不合格"}</Badge></div>{!pending && !gate.passed && <Disclosure title="問題の詳細"><p>{gate.rationale}</p>{gate.locations.length > 0 && <p>箇所: {gate.locations.join(", ")}</p>}</Disclosure>}</li>;})}</ul></Disclosure></>}
    {!running && job.status !== "available" && <div className="job-recovery"><div className="button-row"><button disabled={busy || !canResume} onClick={() => onAction("resume")}>途中から再開</button><button className="text-button" disabled={busy || !canResume} onClick={() => onAction("restart")}>最初から作り直す</button></div>{!canResume && <p className="help">再開にはAI接続と他の作成処理の停止が必要です。</p>}</div>}
  </div>;
}
function Disclosure({title, children, className = ""}: {title: string; children: ReactNode; className?: string}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className={className}><button className="disclosure-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{title}<span>{open ? "閉じる" : "開く"}</span></button><div id={id} hidden={!open}>{children}</div></div>;
}
function SelectField({label, value, options, onChange, disabled}: {label: string; value: string; options: {value: string; label: string}[]; onChange(value: string): void; disabled?: boolean}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {setOpen(false); requestAnimationFrame(() => trigger.current?.focus());};
  return <div className="field"><span id={id}>{label}</span><button ref={trigger} className="select-trigger" aria-labelledby={`${id} ${id}-value`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}><span id={`${id}-value`}>{options.find(option => option.value === value)?.label ?? "選択できる項目がありません"}</span><span className="select-action">選択</span></button>{open && <SelectionDialog label={label} value={value} options={options} onSelect={next => {onChange(next); close();}} onClose={close} />}</div>;
}
function SelectionDialog({label, value, options, onSelect, onClose}: {label: string; value: string; options: {value: string; label: string}[]; onSelect(value: string): void; onClose(): void}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {const dialog = ref.current; dialog?.showModal(); dialog?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus(); return () => dialog?.close();}, []);
  return <dialog className="selection-dialog" ref={ref} aria-labelledby={id} onCancel={onClose}><h2 id={id}>{label}</h2><div className="selection-options" onKeyDown={event => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.focus();
  }}>{options.map(option => <button key={option.value} aria-pressed={option.value === value} onClick={() => onSelect(option.value)}><span>{option.label}</span>{option.value === value && <span className="selected-label">選択中</span>}</button>)}</div><button className="selection-close" onClick={onClose}>変更せず閉じる</button></dialog>;
}
function LocalSignInDialog({onClose}: {onClose(): void}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {const dialog = ref.current; dialog?.showModal(); return () => dialog?.close();}, []);
  return <dialog ref={ref} aria-labelledby="signin-title" onCancel={onClose}><h2 id="signin-title">ChatGPTでサインイン</h2><p>この環境はMacから認証します。AITuberのフォルダで次のコマンドを実行すると、ChatGPTの認証画面が開きます。</p><code>pnpm connect:chatgpt</code><p>認証後、この画面を更新してください。APIキーは不要です。</p><div className="button-row"><button onClick={() => void navigator.clipboard.writeText("pnpm connect:chatgpt").then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? "コピーしました" : "コマンドをコピー"}</button><button autoFocus onClick={onClose}>閉じる</button></div></dialog>;
}
function HeadingIcon({kind}: {kind: string}) {
  const paths: Record<string, ReactNode> = {
    lecture: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4m-3-10 6 3-6 3z" /></>,
    materials: <><path d="M12 5v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z" /></>,
    history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    new: <><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5" /></>,
    connection: <><path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3" /></>,
  };
  return <svg className="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[kind] ?? paths.materials}</svg>;
}
function SectionTitle({title, subtitle, id}: {title: string; subtitle?: string; id: string}) { return <div className="section-title"><h2 id={id}><HeadingIcon kind={id.includes("connection") ? "connection" : id.includes("materials") ? "history" : "lecture"} />{title}</h2>{subtitle && <p>{subtitle}</p>}</div>; }
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
class ApiError extends Error { constructor(message: string, readonly code: string | undefined) {super(message);} }
async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (response.status === 401 || response.redirected || !response.headers.get("content-type")?.includes("application/json")) throw new Error("管理画面へのログインを確認し、ページを再読み込みしてください。");
  const value = await response.json() as T & {message?: string; error?: string};
  if (!response.ok) throw new ApiError(value.message ?? `操作に失敗しました（HTTP ${response.status}）`, value.error);
  return value;
}
function errorMessage(reason: unknown) {return reason instanceof Error ? reason.message : "処理に失敗しました。";}
const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Operator root element was not found");
createRoot(root).render(<StrictMode><OperatorApp /></StrictMode>);
