import {compilePointingPlan} from '@aituber/contracts';
import { speechCaption } from "./speech-caption.ts";
import { useSpeechEnvelope } from "./use-speech-envelope.ts";
import { startSpeechAudio } from "./speech-audio.ts";
import { currentSpeechClock, trackSpeechPlayback } from "./speech-playback.ts";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { ClassroomSnapshot, ClassroomJoinResponse, ClassroomParticipantAccess, ClassroomQuestionView, ClassroomRoomView, ClassroomStreamMessage, FixedSessionView, SubmitQuestionResponse } from "@aituber/contracts";
import { applyBoardPatches, createBoardState, focusSemanticTargets, resolveMascotPresentation, resolveStageScene } from "@aituber/presentation";
import "@fontsource/zen-kaku-gothic-new/japanese-400.css";
import "@fontsource/zen-kaku-gothic-new/japanese-500.css";
import "@fontsource/zen-kaku-gothic-new/japanese-700.css";
import "katex/dist/katex.min.css";
import { LessonStage } from "./lesson-texture.tsx";
import { RichText } from "./rich-text.tsx";
import { QuestionInput } from "./question-input.tsx";

import "./styles.css";

const statusLabels: Record<FixedSessionView["status"], string> = {
  PREPARING: "準備中", TEACHING: "講義中", CHECKPOINT: "確認問題", PAUSED: "一時停止中", RECOVERING: "再開中", FINISHED: "講義終了",
};

function ClassroomApp() {
  const [session, setSession] = useState<FixedSessionView | null>(null);
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get("code") ?? "");
  const [participant, setParticipant] = useState<ClassroomParticipantAccess | null>(null);
  const [room, setRoom] = useState<ClassroomRoomView | null>(null);
  const [connection, setConnection] = useState<"idle" | "connecting" | "live" | "reconnecting">("idle");
  const [joining, setJoining] = useState(false);
  const [audioFloorMs, setAudioFloorMs] = useState(0);
  const [captions, setCaptions] = useState(false);
  const [projecting, setProjecting] = useState(true);
  const shellRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [rail, setRail] = useState<"chat" | "exercise">("chat");
  useEffect(() => { if (session?.assessment?.id) { setRail("exercise"); setPanelOpen(true); } }, [session?.assessment?.id]);
  useEffect(() => {
    const sync = () => setExpanded(Boolean(document.fullscreenElement));
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.fullscreenElement) setExpanded(false); };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("fullscreenchange", sync); document.removeEventListener("keydown", escape); };
  }, []);
  async function toggleFullscreen() {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    if (expanded) { setExpanded(false); return; }
    setPanelOpen(false);
    try { if (shellRef.current?.requestFullscreen) await shellRef.current.requestFullscreen(); else setExpanded(true); }
    catch { setExpanded(true); }
  }
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);
  useEffect(() => { setAnswer(""); }, [session?.assessment?.id]);
  const [questions, setQuestions] = useState<readonly ClassroomQuestionView[]>([]);
  const [questionText, setQuestionText] = useState("");
  const [questioning, setQuestioning] = useState(false);
  const [surveyAnswers, setSurveyAnswers] = useState({ questionHelpfulness: 0, rejoinNaturalness: 0, comment: "" });
  const [surveySubmitting, setSurveySubmitting] = useState(false);
  const [surveySubmitted, setSurveySubmitted] = useState(false);
  const surveyDialog = useRef<HTMLDialogElement>(null);
  const [speechElapsedMs, setSpeechElapsedMs] = useState(0);
  const [audioPlaybackActive, setAudioPlaybackActive] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [reactionActive, setReactionActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const retrySpeechRef = useRef<(() => void) | null>(null);
  const readSpeechLevel = useSpeechEnvelope(audioRef,session?.speech.audioUrl);
  const previousStatusRef = useRef<FixedSessionView["status"] | null>(null);
  const latestSeqRef = useRef(0);

  useEffect(() => {
    const normalized = code.replaceAll(/[-\s]/g, "").toUpperCase();
    const saved = readSavedParticipant();
    if (!saved || saved.code !== normalized) return;
    let active = true;
    setJoining(true);
    void fetchJson<ClassroomJoinResponse>(`/api/classrooms/${encodeURIComponent(saved.code)}/reconnect`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: saved.participant.accessToken }),
    }).then((result) => {
      if (!active) return;
      latestSeqRef.current = result.snapshot.seq; setParticipant(result.participant); setRoom(result.room); setSession(result.snapshot.session); setQuestions(result.questions); setAudioFloorMs(result.snapshot.audioOffsetMs); setError(null);
    }).catch(() => { if (active) window.sessionStorage.removeItem("aituber.classroom.participant"); })
      .finally(() => { if (active) setJoining(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!participant || !room) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let reconnectAttempts = 0;
    const connect = () => {
      if (disposed) return;
      setConnection(latestSeqRef.current ? "reconnecting" : "connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/classrooms/${encodeURIComponent(room.code)}/stream?token=${encodeURIComponent(participant.accessToken)}&afterSeq=${latestSeqRef.current}`);
      socket.onopen = () => setConnection("live");
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as ClassroomStreamMessage;
        reconnectAttempts = 0;
        if (message.snapshot.seq < latestSeqRef.current) return;
        latestSeqRef.current = message.snapshot.seq;
        setSession(message.snapshot.session); setRoom(message.room); setQuestions(message.questions); setAudioFloorMs(message.snapshot.audioOffsetMs); setError(null);
      };
      socket.onclose = () => { if (!disposed) reconnectTimer = window.setTimeout(connect, Math.min(60000, 1000 * 2 ** Math.min(reconnectAttempts++, 6))); };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => { disposed = true; window.clearTimeout(reconnectTimer); socket?.close(); };
  }, [participant?.accessToken, room?.code]);

  useEffect(() => {
    const startedAt = session?.speech.startedAt;
    if (!startedAt || !session.speech.playing) { setSpeechElapsedMs(0); return; }
    const update = () => setSpeechElapsedMs(session.speech.audioUrl
      ? Math.max(0, (audioRef.current?.currentTime ?? 0) * 1000)
      : Math.max(0, Date.now() - Date.parse(startedAt)));
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [session?.speech.startedAt, session?.speech.playing, session?.speech.audioUrl]);

  useEffect(() => {
    if (!session?.speech.playing || !session.speech.audioUrl) setAudioPlaybackActive(false);
  }, [session?.speech.playing, session?.speech.audioUrl]);

  useEffect(() => {
    // The replacement audio element has not started yet, even when the server
    // still marks the next utterance as playing. Wait for its own playing event.
    setAudioPlaybackActive(false);
  }, [session?.speech.audioUrl]);

  useEffect(() => {
    const nextStatus = session?.status ?? null;
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = nextStatus;
    if (!previousStatus || previousStatus === nextStatus || (nextStatus !== "CHECKPOINT" && nextStatus !== "FINISHED")) return;
    setReactionActive(true);
    const timer = window.setTimeout(() => setReactionActive(false), 1_200);
    return () => window.clearTimeout(timer);
  }, [session?.status]);

  useEffect(() => {
    const audio = audioRef.current;
    const startedAt = session?.speech.startedAt;
    if (!audio || !startedAt || !session.speech.audioUrl) return;
    if (audio.getAttribute("src") !== session.speech.audioUrl) audio.setAttribute("src", session.speech.audioUrl);
    const report = (remainingMs: number, playbackState: string) => {
      if (!participant || !room) return;
      void fetch(`/api/classrooms/${encodeURIComponent(room.code)}/playback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: participant.accessToken, epoch: session.speech.epoch, audioUrl: session.speech.audioUrl, remainingMs, playbackState, startedAt }) }).catch(() => {});
    };
    const stopReporting = trackSpeechPlayback(audio,session.speech.durationMs,audioFloorMs,report);
    const playback=startSpeechAudio(audio,audioFloorMs,setAudioBlocked);
    retrySpeechRef.current=playback.retry;
    return () => {
      retrySpeechRef.current=null;
      playback.dispose();
      stopReporting();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [session?.speech.audioUrl, session?.speech.startedAt, participant?.accessToken, room?.code]);

  const readiness = useRef({key:"",attempts:0,pending:false});
  async function classroomReady() {
    if (!room || !participant || session?.status !== "PREPARING") return;
    const key=`${session.id}:${session.epoch}`;
    if (readiness.current.key !== key) readiness.current={key,attempts:0,pending:false};
    const attempt=readiness.current;
    if (attempt.pending || attempt.attempts>=3) return;
    attempt.pending=true;attempt.attempts++;
    try {
      const result=await fetchJson<{snapshot:ClassroomSnapshot}>(`/api/classrooms/${encodeURIComponent(room.code)}/ready`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accessToken:participant.accessToken,epoch:session.epoch})});
      if(result.snapshot.seq>=latestSeqRef.current){latestSeqRef.current=result.snapshot.seq;setSession(result.snapshot.session);setAudioFloorMs(result.snapshot.audioOffsetMs);}
    } catch(reason) { if(attempt.attempts>=3)setError(`授業の開始を確認できませんでした。再読み込みして接続し直してください。${errorMessage(reason)}`); }
    finally {attempt.pending=false;}
  }

  async function joinClassroom(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setJoining(true); setError(null);
    try {
      const normalized = code.replaceAll(/[-\s]/g, "").toUpperCase();
      const result = await fetchJson<ClassroomJoinResponse>("/api/classrooms/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: normalized }) });
      latestSeqRef.current = result.snapshot.seq; setCode(normalized); setParticipant(result.participant); setRoom(result.room); setSession(result.snapshot.session); setQuestions(result.questions); setAudioFloorMs(result.snapshot.audioOffsetMs);
      window.sessionStorage.setItem("aituber.classroom.participant", JSON.stringify({ code: normalized, participant: result.participant }));
      window.history.replaceState(null, "", `?code=${encodeURIComponent(normalized)}`);
    } catch (reason) { setError(errorMessage(reason)); } finally { setJoining(false); }
  }

  const pointAt = useMemo(() => {
    if (!session?.speech.unitId) return ():string|null|undefined => undefined;
    const beats=session.course.performance?.units.find(unit=>unit.unitId===session.speech.unitId)?.beats??[];
    const matching=beats.filter(beat=>beat.text===session.speech.text);
    const plan=matching.length===1?matching[0]?.pointing:undefined;
    if(!plan&&beats.some(beat=>beat.pointing&&beat.pointing.mode!=='auto'))return ()=>null;
    return compilePointingPlan(plan,session.speech.text??'',session.speech.segments);
  }, [session?.course.performance,session?.speech.unitId,session?.speech.text,session?.speech.segments]);

  const displayUnit = session?.course.teachingUnits.find((unit) => unit.id === session.displayUnitId) ?? null;
  const supplementCandidate = session?.liveSupplement?.status === "playing" ? session.liveSupplement.candidate : null;
  const activeSpeechSegment = session?.speech.playing ? session.speech.segments.find((segment) => speechElapsedMs >= segment.startMs && speechElapsedMs < segment.endMs) ?? null : null;
  const scene = useMemo(() => {
    if (!session || !displayUnit) return null;
    const sceneId = supplementCandidate?.sceneId ?? displayUnit.sceneId;
    const corrections = session.boardCorrections.filter((patch) => patch.sceneId === sceneId).map((patch) => ({ operation: "replace" as const, targetId: patch.targetId, content: patch.content }));
    let board = applyBoardPatches(session.course, createBoardState(session.course, sceneId), sceneId === displayUnit.sceneId ? displayUnit.boardPatches : []);
    board = applyBoardPatches(session.course, board, corrections);
    board = applyBoardPatches(session.course, board, supplementCandidate?.boardPatches ?? []);
    const targetIds = activeSpeechSegment?.semanticTargetIds.length
      ? activeSpeechSegment.semanticTargetIds
      : supplementCandidate?.focusTargetIds ?? displayUnit.focusTargetIds;
    board = focusSemanticTargets(session.course, board, targetIds);
    return resolveStageScene(session.course, sceneId, board);
  }, [session, displayUnit, supplementCandidate, activeSpeechSegment]);
  const slideScene = useMemo(() => {
    if (!session || !displayUnit) return null;
    return resolveStageScene(session.course, displayUnit.sceneId, applyBoardPatches(session.course, createBoardState(session.course, displayUnit.sceneId), displayUnit.boardPatches));
  }, [session?.course, displayUnit]);
  const noteTargetIds = new Set([
    ...(supplementCandidate?.boardPatches.map(patch => patch.targetId) ?? []),
    ...(session?.boardCorrections.filter(patch => patch.sceneId === scene?.id).map(patch => patch.targetId) ?? []),
  ]);
  const boardNotes = scene?.targets.filter(target => noteTargetIds.has(target.id)) ?? [];
  const focusedTarget = scene?.targets.find((target) => target.visible && target.id === scene.focusedTargetId) ?? null;
  const mascotPresentation = resolveMascotPresentation({
    audiblePlayback: audioPlaybackActive && session?.speech.mode !== "caption-fallback",
    elapsedMs: speechElapsedMs,
    segment: activeSpeechSegment,
    targetId: focusedTarget?.id ?? null,
    targetLabel: focusedTarget?.label ?? null,
    reactionActive,
  });

  useEffect(() => {
    setProjecting(session?.direction?.surface ? session.direction.surface === "slides" : !supplementCandidate);
  }, [displayUnit?.id, Boolean(supplementCandidate), session?.direction?.surface]);

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!session || !participant || !room || !answer.trim()) return;
    setAnswering(true); setError(null);
    try {
      const result = await fetchJson<{ snapshot: ClassroomStreamMessage["snapshot"] }>(`/api/classrooms/${encodeURIComponent(room.code)}/answer`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: participant.accessToken, answer: answer.trim() }),
      });
      if (result.snapshot.seq >= latestSeqRef.current) { latestSeqRef.current = result.snapshot.seq; setSession(result.snapshot.session); }
      if (result.snapshot.session.lastAssessmentEvaluation?.outcome === "correct") setAnswer("");
    } catch (reason) { setError(errorMessage(reason)); } finally { setAnswering(false); }
  }

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (!session || !participant || !room || !scene || !questionText.trim()) return;
    setQuestioning(true); setError(null);
    try {
      const result = await fetchJson<SubmitQuestionResponse>(`/api/classrooms/${encodeURIComponent(room.code)}/questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: participant.accessToken, text: questionText.trim(), sceneId: scene.id }) });
      setQuestions(result.questions); setSession(result.snapshot.session); setQuestionText("");
    } catch (reason) { setError(errorMessage(reason)); } finally { setQuestioning(false); }
  }

  async function submitSurvey(event: FormEvent) {
    event.preventDefault(); if (!participant || !room || !surveyAnswers.questionHelpfulness || !surveyAnswers.rejoinNaturalness) return;
    setSurveySubmitting(true); setError(null);
    try { await fetchJson(`/api/classrooms/${encodeURIComponent(room.code)}/survey`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: participant.accessToken, ...surveyAnswers }) }); setSurveySubmitted(true); }
    catch (reason) { setError(errorMessage(reason)); } finally { setSurveySubmitting(false); }
  }

  if (!session) return <JoinClassroom code={code} setCode={setCode} joining={joining} error={error} onSubmit={joinClassroom} />;

  return (
    <main ref={shellRef} className={`classroom-shell${expanded ? " classroom-shell--expanded" : ""}`}>
      <header className="lesson-header">
        <div className="studio-brand" aria-label="AITuber classroom">
          <span className="studio-sigil" aria-hidden="true"><span /></span>
          <span>AITuber</span>
        </div>
        <div className="lesson-heading">
          <p className={`lesson-status lesson-status--${session.status.toLowerCase()}`}>{statusLabels[session.status]}</p>
          <h1>{session.course.title}</h1>
        </div>
        <div className="lesson-meta">
          {connection !== "live" && <p className="connection" role="status">接続を確認しています</p>}

        </div>
      </header>

      <div className="broadcast-layout">
        <div className="broadcast-main">
          {session.speech.failure && <p className="error" role="alert">{session.speech.failure}</p>}
          {session.status === "PAUSED" && <p className="notice" role="status">一時停止中</p>}
          <audio ref={audioRef} className="speech-audio" hidden preload="auto" playsInline onPlaying={() => setAudioPlaybackActive(true)} onWaiting={() => setAudioPlaybackActive(false)} onSeeking={() => setAudioPlaybackActive(false)} onEmptied={() => setAudioPlaybackActive(false)} onError={() => setAudioPlaybackActive(false)} onPause={() => setAudioPlaybackActive(false)} onEnded={() => setAudioPlaybackActive(false)} />
          {error && <p className="error" role="alert">{error}</p>}

          {scene && <section className="stage" aria-label={scene.title}>
            <LessonStage readPointTarget={()=>{
              if(!projecting)return undefined;
              if(!session.speech.playing)return pointAt(NaN);
              const clock=currentSpeechClock(audioRef.current,session.speech);
              const elapsed=session.speech.mode==='caption-fallback'?speechElapsedMs:clock?clock.elapsed*1000:NaN;
              return pointAt(elapsed);
            }} spokenText={session.speech.segments.length ? speechCaption(session.speech.segments, speechElapsedMs, session.course.pronunciationDictionary, session.speech.text, session.speech.transcriptFormat === "original") : session.speech.text ?? ""} onReady={session.status === "PREPARING" ? () => { void classroomReady(); } : undefined} slideAccess={room && participant ? {code:room.code,accessToken:participant.accessToken} : undefined} listening={(session.status === "CHECKPOINT" || session.status === "FINISHED") && !session.speech.playing} speaking={audioPlaybackActive} readSpeechClock={() => { const audio=audioRef.current; if (session.speech.mode === "caption-fallback" && session.speech.playing) return {elapsed:speechElapsedMs/1000,duration:session.speech.durationMs/1000}; return currentSpeechClock(audio,session.speech); }} readSpeechLevel={readSpeechLevel} scene={slideScene ?? scene} notes={boardNotes} noteText={supplementCandidate && boardNotes.length === 0 ? supplementCandidate.captionText : undefined} presentation={mascotPresentation} projecting={projecting} onSelect={() => { setRail("chat"); setPanelOpen(true); }} direction={session.direction} onStageProgress={(actionId, writingStarted) => { if (!room || !participant) return; void fetch(`/api/classrooms/${encodeURIComponent(room.code)}/stage-progress`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({accessToken:participant.accessToken,epoch:session.epoch,actionId,writingStarted}) }).catch(() => {}); }} onStageComplete={(actionId) => { if (!room || !participant) return; void fetch(`/api/classrooms/${encodeURIComponent(room.code)}/stage-complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({accessToken:participant.accessToken,epoch:session.epoch,actionId}) }).catch(() => {}); }} />
            <div className="stage-controls" role="group" aria-label="講義の操作">
              <button title={projecting ? "黒板を見る" : "スライドを見る"} aria-label={projecting ? "黒板を見る" : "スライドを見る"} onClick={() => setProjecting(!projecting)}><ControlIcon name="board" /></button>
              <button title="字幕" aria-label="字幕" aria-pressed={captions} onClick={() => setCaptions(!captions)}><ControlIcon name="captions" /></button>
              {audioBlocked && session.speech.audioUrl && <button title="音声を再生" aria-label="音声を再生" onClick={() => retrySpeechRef.current?.()}><ControlIcon name="audio" /></button>}
              <span className="stage-controls-spacer" />
              {expanded && <><button title="質問・コメント" aria-label="質問・コメント" aria-controls="lecture-panel" aria-expanded={panelOpen && rail === "chat"} onClick={() => { setPanelOpen(!panelOpen || rail !== "chat"); setRail("chat"); }}><ControlIcon name="chat" /></button><button title="確認問題" aria-label="確認問題" aria-controls="lecture-panel" aria-expanded={panelOpen && rail === "exercise"} onClick={() => { setPanelOpen(!panelOpen || rail !== "exercise"); setRail("exercise"); }}><ControlIcon name="exercise" />{session.assessment && <span className="control-badge" />}</button></>}
              <button title={expanded ? "全画面を終了" : "全画面表示"} aria-label={expanded ? "全画面を終了" : "全画面表示"} aria-pressed={expanded} onClick={() => void toggleFullscreen()}><ControlIcon name={expanded ? "collapse" : "expand"} /></button>
            </div>
            {(captions || session.speech.mode === "caption-fallback") && session.speech.playing && displayUnit && (session.speech.text || !session.direction) && <section className="caption" aria-labelledby="caption-title" aria-live="polite"><h2 id="caption-title"><span aria-hidden="true" />字幕</h2><p>{speechCaption(session.speech.segments, speechElapsedMs, session.course.pronunciationDictionary, session.speech.text, session.speech.transcriptFormat === "original") || (session.speech.audioUrl ? "" : session.speech.text ?? supplementCandidate?.captionText ?? displayUnit.captionText ?? displayUnit.speechText)}</p></section>}
          </section>}



          {session.status === "FINISHED" && <section className="lesson-ended"><p>授業が終了しました。引き続きコメント・質問を受け付けています。</p><button onClick={() => surveyDialog.current?.showModal()}>退出する</button></section>}
          <dialog ref={surveyDialog} className="exit-survey" aria-label="退出前の任意アンケート"><div className="exit-survey-content">
            <h3>任意アンケート</h3>{surveySubmitted ? <p className="survey-complete" role="status">回答を保存しました。</p> : <form className="after-class-survey" onSubmit={(event) => void submitSurvey(event)}><RatingField legend="質問した箇所を理解しやすくなりましたか" value={surveyAnswers.questionHelpfulness} onChange={(value) => setSurveyAnswers((current) => ({ ...current, questionHelpfulness: value }))} /><RatingField legend="補足後、本編へ自然に戻れましたか" value={surveyAnswers.rejoinNaturalness} onChange={(value) => setSurveyAnswers((current) => ({ ...current, rejoinNaturalness: value }))} /><label>自由記述<textarea maxLength={2000} value={surveyAnswers.comment} onChange={(event) => setSurveyAnswers((current) => ({ ...current, comment: event.target.value }))} /></label><button disabled={surveySubmitting || !surveyAnswers.questionHelpfulness || !surveyAnswers.rejoinNaturalness}>{surveySubmitting ? "保存中…" : "任意アンケートを送る"}</button></form>}
            <div className="exit-actions"><button onClick={() => surveyDialog.current?.close()}>教室に戻る</button><button onClick={() => { window.sessionStorage.removeItem("aituber.classroom.participant"); window.location.assign("/"); }}>{surveySubmitted ? "退出する" : "回答せずに退出する"}</button></div>
          </div></dialog>
        </div>
        <aside id="lecture-panel" className="lecture-rail" hidden={expanded && !panelOpen} aria-label="質問と確認問題">
          <nav className="rail-tabs" aria-label="パネルの切り替え">
            <button aria-pressed={rail === "chat"} aria-controls="chat-panel" onClick={() => setRail("chat")}><ControlIcon name="chat" />質問</button>
            <button aria-pressed={rail === "exercise"} aria-controls="exercise-panel" onClick={() => setRail("exercise")}><ControlIcon name="exercise" />確認問題</button>
            {expanded && <button className="panel-close" title="パネルを閉じる" aria-label="パネルを閉じる" onClick={() => setPanelOpen(false)}><ControlIcon name="close" /></button>}
          </nav>
          {session.assessment && <section id="exercise-panel" hidden={rail !== "exercise"} className="checkpoint" aria-labelledby="checkpoint-title">
            <h2 id="checkpoint-title" className="visually-hidden">確認問題</h2><div className="checkpoint-prompt"><RichText text={session.assessment.prompt} /></div>
            {!answering && session.lastAssessmentEvaluation?.assessmentId === session.assessment.id && <div role="status" className={`assessment-result assessment-result--${session.lastAssessmentEvaluation.outcome}`}>
              <p><strong>{session.lastAssessmentEvaluation.outcome === "correct" ? "正解です。" : "前回の回答へのコメント"}</strong></p>
              <p>{session.lastAssessmentEvaluation.rationale}</p>
              {session.lastAssessmentEvaluation.outcome !== "correct" && <p>回答を編集して、もう一度送れます。</p>}
            </div>}
            <form aria-busy={answering || session.status !== "CHECKPOINT"} onSubmit={(event) => void submitAnswer(event)}>
              {session.assessment.responseKind === "multiple-choice" ? <fieldset disabled={answering || session.status !== "CHECKPOINT"}><legend>回答を一つ選んでください</legend>{session.assessment.options.map((option) => <label key={option}><input type="radio" name="answer" value={option} checked={answer === option} onChange={() => setAnswer(option)} /> <RichText text={option} /></label>)}</fieldset>
                : <label className="answer-field">回答<textarea aria-label="回答" rows={3} disabled={answering || session.status !== "CHECKPOINT"} value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>}
              <button type="submit" disabled={answering || session.status !== "CHECKPOINT" || !answer.trim()}>{answering ? "回答を確認中…" : session.status !== "CHECKPOINT" ? session.liveSupplement?.status === "playing" ? "解説中" : "回答を送る" : "回答を送る"}</button>
            </form>
          </section>}
          {!session.assessment && <section id="exercise-panel" className="empty-exercise" hidden={rail !== "exercise"}><p>まだ問題はありません</p></section>}
          {scene && <section id="chat-panel" hidden={rail !== "chat"} className="chat-panel" aria-label="コメントと質問">

            <div className="chat-messages" role="log" aria-label="質問の受付状況">
              {[...questions].sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt)).map((question) => <article className="chat-message" key={question.id}><strong>{question.origin !== "learner-question" ? "先生" : question.triage === "comment" || question.triage === "ignore" || question.triage === "pending" ? "コメント" : "質問"} <small>{question.triage === "ignore" ? "" : question.triage === "pending" ? "受付済み" : question.triage === "comment" ? "授業後にお返事" : question.resolution === "answered" ? "回答済み" : question.resolution === "deferred" ? "授業後に回答" : "受付済み"}</small></strong><RichText text={question.origin === "pedagogy-trigger" ? "確認問題の補足" : question.text} /></article>)}
              {session.afterClassAnswers.map(item => <article className="chat-message" key={item.id}><strong>先生 <small>{item.status === "preparing" ? "回答を準備中" : item.status === "unanswered" ? "回答できませんでした" : "授業後の回答"}</small></strong><blockquote>{item.questionText}</blockquote>{item.answerText && <RichText text={item.answerText} />}{item.failure && <p>{item.failure}</p>}</article>)}
            </div>
            {<form className="chat-composer" onSubmit={(event) => void submitQuestion(event)}>
              <QuestionInput value={questionText} onChange={setQuestionText} sending={questioning} />
            </form>}
          </section>}
        </aside>
      </div>
    </main>
  );
}


function ControlIcon({name}: {name: "board" | "captions" | "audio" | "chat" | "exercise" | "expand" | "collapse" | "close"}) {
  const paths = {
    board: "M3 4h18v13H3z M8 21l4-4 4 4",
    captions: "M3 5h18v14H3z M10 10H7v4h3 M17 10h-3v4h3",
    audio: "M4 9h4l5-4v14l-5-4H4z M17 8c3 2 3 6 0 8",
    chat: "M4 4h16v12H9l-5 4z",
    exercise: "M9 3h6v4H9z M9 5H5v16h14V5h-4 M8 13l3 3 5-6",
    expand: "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5",
    collapse: "M3 8h5V3 M21 8h-5V3 M16 21v-5h5 M8 21v-5H3",
    close: "M6 6l12 12 M18 6 6 18",
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function JoinClassroom({ code, setCode, joining, error, onSubmit }: { code: string; setCode(value: string): void; joining: boolean; error: string | null; onSubmit(event: FormEvent): void }) {
  return <main className="centered-message join-card"><div className="studio-brand"><span className="studio-sigil" aria-hidden="true"><span /></span><span>AITuber</span></div><h1>教室に入る</h1><p>運営画面に表示された6文字の教室コードを入力してください。</p><form onSubmit={onSubmit}><label>教室コード<input autoFocus autoComplete="off" inputMode="text" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ABC234" /></label><button disabled={joining || code.replaceAll(/[-\s]/g, "").length !== 6}>{joining ? "接続中…" : "参加する"}</button></form>{error && <p className="error" role="alert">{error}</p>}</main>;
}
function RatingField({ legend, value, onChange }: { legend: string; value: number; onChange(value: number): void }) { return <fieldset><legend>{legend}</legend><div>{[1, 2, 3, 4, 5].map((rating) => <label key={rating}><input type="radio" name={legend} value={rating} checked={value === rating} onChange={() => onChange(rating)} />{rating}</label>)}</div></fieldset>; }
async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> { const response = await fetch(input, init); const value = await response.json() as T & { message?: string }; if (!response.ok) throw new Error(value.message ?? `HTTP ${response.status}`); return value; }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : "処理に失敗しました。"; }
function readSavedParticipant(): { code: string; participant: ClassroomParticipantAccess } | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem("aituber.classroom.participant") ?? "null") as { code?: unknown; participant?: Partial<ClassroomParticipantAccess> } | null;
    return value && typeof value.code === "string" && typeof value.participant?.id === "string" && typeof value.participant.accessToken === "string"
      ? { code: value.code, participant: { id: value.participant.id, accessToken: value.participant.accessToken } } : null;
  } catch { return null; }
}

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Classroom root element was not found");
if (new URLSearchParams(location.search).has("motion-lab")) {
  void import("./motion-lab.tsx").then(({mountMotionLab})=>mountMotionLab(root));
} else createRoot(root).render(<StrictMode><ClassroomApp /></StrictMode>);
