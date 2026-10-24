import { speechCaption } from "./speech-caption.ts";
import { useSpeechEnvelope } from "./use-speech-envelope.ts";
import { startSpeechAudio } from "./speech-audio.ts";
import { trackSpeechPlayback } from "./speech-playback.ts";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { ClassroomSnapshot, ClassroomJoinResponse, ClassroomParticipantAccess, ClassroomQuestionView, ClassroomRoomView, ClassroomStreamMessage, FixedSessionView, SubmitQuestionResponse } from "@aituber/contracts";
import { applyBoardPatches, createBoardState, focusSemanticTargets, resolveMascotPresentation, resolveStageScene } from "@aituber/presentation";
import "@fontsource/zen-kaku-gothic-new/japanese-400.css";
import "@fontsource/zen-kaku-gothic-new/japanese-500.css";
import "@fontsource/zen-kaku-gothic-new/japanese-700.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
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
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [captions, setCaptions] = useState(false);
  const [projecting, setProjecting] = useState(true);
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);
  const [questions, setQuestions] = useState<readonly ClassroomQuestionView[]>([]);
  const [questionText, setQuestionText] = useState("");
  const [questioning, setQuestioning] = useState(false);
  const [, setEvidenceSubmitting] = useState(false);
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
      : selectedTargetId ? [selectedTargetId] : supplementCandidate?.focusTargetIds ?? displayUnit.focusTargetIds;
    board = focusSemanticTargets(session.course, board, targetIds);
    return resolveStageScene(session.course, sceneId, board);
  }, [session, displayUnit, supplementCandidate, selectedTargetId, activeSpeechSegment]);
  const evidenceTargetId = selectedTargetId ?? displayUnit?.focusTargetIds[0] ?? null;
  const slideScene = useMemo(() => {
    if (!session || !displayUnit) return null;
    return resolveStageScene(session.course, displayUnit.sceneId, applyBoardPatches(session.course, createBoardState(session.course, displayUnit.sceneId), displayUnit.boardPatches));
  }, [session?.course, displayUnit]);
  const noteTargetIds = new Set([
    ...(supplementCandidate?.boardPatches.map(patch => patch.targetId) ?? []),
    ...(session?.boardCorrections.filter(patch => patch.sceneId === scene?.id).map(patch => patch.targetId) ?? []),
  ]);
  const boardNotes = scene?.targets.filter(target => noteTargetIds.has(target.id)) ?? [];
  const focusedTarget = scene?.targets.find((target) => target.visible && target.id === (selectedTargetId ?? scene.focusedTargetId)) ?? null;
  const mascotPresentation = resolveMascotPresentation({
    audiblePlayback: audioPlaybackActive && session?.speech.mode !== "caption-fallback",
    elapsedMs: speechElapsedMs,
    segment: activeSpeechSegment,
    targetId: focusedTarget?.id ?? null,
    targetLabel: focusedTarget?.label ?? null,
    reactionActive,
  });

  useEffect(() => { setSelectedTargetId(null); }, [scene?.id, displayUnit?.id]);
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
      setSession(result.snapshot.session); setAnswer("");
    } catch (reason) { setError(errorMessage(reason)); } finally { setAnswering(false); }
  }

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (!session || !participant || !room || !scene || !questionText.trim()) return;
    setQuestioning(true); setError(null);
    try {
      const result = await fetchJson<SubmitQuestionResponse>(`/api/classrooms/${encodeURIComponent(room.code)}/questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: participant.accessToken, text: questionText.trim(), sceneId: scene.id, ...(selectedTargetId ? { semanticTargetId: selectedTargetId } : {}) }) });
      setQuestions(result.questions); setSession(result.snapshot.session); setQuestionText("");
    } catch (reason) { setError(errorMessage(reason)); } finally { setQuestioning(false); }
  }

  async function submitEvidence(kind: "self-report" | "explicit-action", value: "understood" | "need-help" | "recheck" | "target-selected", targetId = evidenceTargetId) {
    if (!session || !participant || !room || !targetId) return;
    const target = session.course.semanticTargets.find((item) => item.id === targetId); if (!target) return;
    setEvidenceSubmitting(true); setError(null);
    try {
      const result = await fetchJson<{ snapshot: ClassroomStreamMessage["snapshot"] }>(`/api/classrooms/${encodeURIComponent(room.code)}/evidence`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: participant.accessToken, kind, value, sceneId: target.sceneId, semanticTargetId: target.id }) });
      setSession(result.snapshot.session);
    } catch (reason) { setError(errorMessage(reason)); } finally { setEvidenceSubmitting(false); }
  }

  function selectTarget(targetId: string) { setSelectedTargetId(targetId); void submitEvidence("explicit-action", "target-selected", targetId); }

  async function submitSurvey(event: FormEvent) {
    event.preventDefault(); if (!participant || !room || !surveyAnswers.questionHelpfulness || !surveyAnswers.rejoinNaturalness) return;
    setSurveySubmitting(true); setError(null);
    try { await fetchJson(`/api/classrooms/${encodeURIComponent(room.code)}/survey`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: participant.accessToken, ...surveyAnswers }) }); setSurveySubmitted(true); }
    catch (reason) { setError(errorMessage(reason)); } finally { setSurveySubmitting(false); }
  }

  if (!session) return <JoinClassroom code={code} setCode={setCode} joining={joining} error={error} onSubmit={joinClassroom} />;

  return (
    <main className="classroom-shell">
      <header className="lesson-header">
        <div className="studio-brand" aria-label="AITuber classroom">
          <span className="studio-sigil" aria-hidden="true"><span /></span>
          <span>AITUBER</span>
        </div>
        <div className="lesson-heading">
          <p className={`lesson-status lesson-status--${session.status.toLowerCase()}`}><span aria-hidden="true" />{statusLabels[session.status]}</p>
          <h1>{session.course.title}</h1>
        </div>
        <div className="lesson-meta"><p className={`connection connection--${connection}`} role="status"><span aria-hidden="true" />{connection === "live" ? `同期中 · ${room?.participantCount ?? 0}人` : "再接続中"}</p><p className="lesson-progress" aria-label="講義の進行状況"><span>進行</span>{session.progress.completed}<b>/</b>{session.progress.total}</p></div>
      </header>

      <div className="broadcast-layout">
        <div className="broadcast-main">
          {session.speech.failure && <p className="error" role="alert">{session.speech.failure}</p>}
          {session.status === "PAUSED" && <p className="notice" role="status">講義は一時停止中です。再開すると、この説明から続きます。</p>}
          {session.liveSupplement?.status === "preparing" && <p className="notice notice--supplement" role="status">質問に答える補足を教材から準備しています。本編は安全な区切りまで続きます。</p>}
          {session.liveSupplement?.status === "bridging" && <p className="notice notice--supplement" role="status">次の説明に必要な質問です。補足の準備中につなぎ説明をしています。</p>}
          {session.status !== "FINISHED" && session.liveSupplement?.status === "deferred" && <p className="notice" role="status">{session.status === "CHECKPOINT" ? "補足を用意できませんでした。回答を見直して、もう一度送信できます。" : "この質問は授業後に回答します。本編を続けます。"}</p>}
          {session.lastAssessmentEvaluation?.outcome === "incorrect" && session.liveSupplement && !new Set(["completed", "deferred"]).has(session.liveSupplement.status) && <p className="notice notice--learning" role="status">確認問題の回答から、もう一度確かめる箇所が見つかりました。短い補足のあと同じ問いで確認します。</p>}
          {session.speech.playing && <div className="playback" role="status"><span className="playback-dot" aria-hidden="true" />{session.speech.mode === "fish-audio" ? (session.speech.provider === "fish-audio" ? "Fish Audioで読み上げ中" : "音声同期をテスト中") : session.speech.mode === "caption-fallback" ? "音声を使わず字幕で進行中" : session.speech.mode === "preparing" ? "音声を準備中" : "固定テスト音声を再生中"}</div>}
          {session.speech.audioUrl && <audio ref={audioRef} className="speech-audio" key={session.speech.audioUrl} src={session.speech.audioUrl} hidden preload="auto" onPlaying={() => setAudioPlaybackActive(true)} onWaiting={() => setAudioPlaybackActive(false)} onSeeking={() => setAudioPlaybackActive(false)} onEmptied={() => setAudioPlaybackActive(false)} onError={() => setAudioPlaybackActive(false)} onPause={() => setAudioPlaybackActive(false)} onEnded={() => setAudioPlaybackActive(false)} />}
          {error && <p className="error" role="alert">{error}</p>}

          {scene && <section className="stage" aria-label={scene.title}>
            <LessonStage onReady={session.status === "PREPARING" ? () => { void classroomReady(); } : undefined} slideAccess={room && participant ? {code:room.code,accessToken:participant.accessToken} : undefined} listening={(session.status === "CHECKPOINT" || session.status === "FINISHED") && !session.speech.playing} speaking={audioPlaybackActive} readSpeechClock={() => { const audio=audioRef.current; if (session.speech.mode === "caption-fallback" && session.speech.playing) return {elapsed:speechElapsedMs/1000,duration:session.speech.durationMs/1000}; return audio && Number.isFinite(audio.duration) && audio.duration > 0 ? {elapsed:audio.currentTime,duration:audio.duration} : null; }} readSpeechLevel={readSpeechLevel} scene={slideScene ?? scene} notes={boardNotes} noteText={supplementCandidate && boardNotes.length === 0 ? supplementCandidate.captionText : undefined} presentation={mascotPresentation} projecting={projecting} onSelect={selectTarget} direction={session.direction} onStageProgress={(actionId, writingStarted) => { if (!room || !participant) return; void fetch(`/api/classrooms/${encodeURIComponent(room.code)}/stage-progress`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({accessToken:participant.accessToken,epoch:session.epoch,actionId,writingStarted}) }).catch(() => {}); }} onStageComplete={(actionId) => { if (!room || !participant) return; void fetch(`/api/classrooms/${encodeURIComponent(room.code)}/stage-complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({accessToken:participant.accessToken,epoch:session.epoch,actionId}) }).catch(() => {}); }} />
            <div className="stage-controls"><button aria-pressed={projecting} onClick={() => setProjecting(!projecting)}>{projecting ? "黒板" : "スライド"}</button><button aria-pressed={captions} onClick={() => setCaptions(!captions)}>字幕 {captions ? "ON" : "OFF"}</button>{audioBlocked && session.speech.audioUrl && <button onClick={() => retrySpeechRef.current?.()}>音声を再生</button>}</div>
            {(captions || session.speech.mode === "caption-fallback") && session.speech.playing && displayUnit && (session.speech.text || !session.direction) && <section className="caption" aria-labelledby="caption-title" aria-live="polite"><h2 id="caption-title"><span aria-hidden="true" />{supplementCandidate ? "ライブ補足" : "字幕"}</h2><p>{speechCaption(session.speech.segments, speechElapsedMs, session.course.pronunciationDictionary, session.speech.text) || (session.speech.audioUrl ? "" : session.speech.text ?? supplementCandidate?.captionText ?? displayUnit.captionText ?? displayUnit.speechText)}</p></section>}
          </section>}

          {session.assessment && <section className="checkpoint" aria-labelledby="checkpoint-title">
            <h2 id="checkpoint-title">確認問題</h2><div className="checkpoint-prompt"><RichText text={session.assessment.prompt} /></div>
            {session.lastAssessmentEvaluation?.assessmentId === session.assessment.id && <p className={`assessment-result assessment-result--${session.lastAssessmentEvaluation.outcome}`}>{session.lastAssessmentEvaluation.outcome === "correct" ? "正解です。" : session.lastAssessmentEvaluation.outcome === "incorrect" ? session.liveSupplement?.status === "deferred" ? "回答を見直して、もう一度答えてみましょう。" : "解説を聞いて、もう一度考えてみましょう。" : "この回答だけでは確認できませんでした。"}</p>}
            <form aria-busy={answering || session.status !== "CHECKPOINT"} onSubmit={(event) => void submitAnswer(event)}>
              {session.assessment.responseKind === "multiple-choice" ? <fieldset disabled={answering || session.status !== "CHECKPOINT"}><legend>回答を一つ選んでください</legend>{session.assessment.options.map((option) => <label key={option}><input type="radio" name="answer" value={option} checked={answer === option} onChange={() => setAnswer(option)} /> <RichText text={option} /></label>)}</fieldset>
                : <label className="answer-field">回答<textarea aria-label="回答" rows={3} disabled={answering || session.status !== "CHECKPOINT"} value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>}
              <button type="submit" disabled={answering || session.status !== "CHECKPOINT" || !answer.trim()}>{answering ? "回答を確認中…" : session.status !== "CHECKPOINT" ? session.liveSupplement?.status === "playing" ? "解説中" : "解説を準備中…" : "回答を送る"}</button>
            </form>
          </section>}

          {session.status === "FINISHED" && <section className="lesson-ended"><p>授業が終了しました。引き続きコメント・質問を受け付けています。</p><button onClick={() => surveyDialog.current?.showModal()}>退出する</button></section>}
          <dialog ref={surveyDialog} className="exit-survey" aria-label="退出前の任意アンケート"><div className="exit-survey-content">
            <h3>任意アンケート</h3>{surveySubmitted ? <p className="survey-complete" role="status">回答を保存しました。学習の証拠とは別に扱われます。</p> : <form className="after-class-survey" onSubmit={(event) => void submitSurvey(event)}><RatingField legend="質問した箇所を理解しやすくなりましたか" value={surveyAnswers.questionHelpfulness} onChange={(value) => setSurveyAnswers((current) => ({ ...current, questionHelpfulness: value }))} /><RatingField legend="補足後、本編へ自然に戻れましたか" value={surveyAnswers.rejoinNaturalness} onChange={(value) => setSurveyAnswers((current) => ({ ...current, rejoinNaturalness: value }))} /><label>自由記述<textarea maxLength={2000} value={surveyAnswers.comment} onChange={(event) => setSurveyAnswers((current) => ({ ...current, comment: event.target.value }))} /></label><button disabled={surveySubmitting || !surveyAnswers.questionHelpfulness || !surveyAnswers.rejoinNaturalness}>{surveySubmitting ? "保存中…" : "任意アンケートを送る"}</button></form>}
            <div className="exit-actions"><button onClick={() => surveyDialog.current?.close()}>教室に戻る</button><button onClick={() => { window.sessionStorage.removeItem("aituber.classroom.participant"); window.location.assign("/"); }}>{surveySubmitted ? "退出する" : "回答せずに退出する"}</button></div>
          </div></dialog>
        </div>
        <aside className="lecture-rail">
          {scene && <section className="chat-panel" aria-label="コメントと質問">
            <h2>コメント <small>{room?.participantCount ?? 0}人</small></h2>
            <div className="chat-messages" role="log" aria-label="質問の受付状況">
              {questions.length === 0 && <p className="chat-empty">気になる箇所をクリックして質問できます。</p>}
              {[...questions].sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt)).map((question) => <article className="chat-message" key={question.id}><strong>{question.origin !== "learner-question" ? "先生" : question.triage === "comment" || question.triage === "ignore" || question.triage === "pending" ? "コメント" : "質問"} <small>{question.triage === "ignore" ? "" : question.triage === "pending" ? "受付済み" : question.triage === "comment" ? "授業後にお返事" : question.resolution === "answered" ? "回答済み" : question.resolution === "deferred" ? "授業後に回答" : "受付済み"}</small></strong><RichText text={question.origin === "pedagogy-trigger" ? "確認問題の補足" : question.text} /></article>)}
              {session.afterClassAnswers.map(item => <article className="chat-message" key={item.id}><strong>先生 <small>{item.status === "preparing" ? "回答を準備中" : item.status === "unanswered" ? "回答できませんでした" : "授業後の回答"}</small></strong><blockquote>{item.questionText}</blockquote>{item.answerText && <RichText text={item.answerText} />}{item.failure && <p>{item.failure}</p>}</article>)}
            </div>
            {<form className="chat-composer" onSubmit={(event) => void submitQuestion(event)}>
              <label className="chat-target">質問先<select aria-label="質問する箇所" value={selectedTargetId ?? ""} onChange={(event) => event.target.value ? selectTarget(event.target.value) : setSelectedTargetId(null)}><option value="">指定なし</option>{scene.targets.filter((target) => target.visible).map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label>
              <QuestionInput value={questionText} onChange={setQuestionText} sending={questioning} />
            </form>}
          </section>}
        </aside>
      </div>
    </main>
  );
}


function JoinClassroom({ code, setCode, joining, error, onSubmit }: { code: string; setCode(value: string): void; joining: boolean; error: string | null; onSubmit(event: FormEvent): void }) {
  return <main className="centered-message join-card"><div className="studio-brand"><span className="studio-sigil" aria-hidden="true"><span /></span><span>AITUBER</span></div><p className="section-kicker">CLASSROOM</p><h1>教室に入る</h1><p>運営画面に表示された6文字の教室コードを入力してください。</p><form onSubmit={onSubmit}><label>教室コード<input autoFocus autoComplete="off" inputMode="text" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ABC234" /></label><button disabled={joining || code.replaceAll(/[-\s]/g, "").length !== 6}>{joining ? "接続中…" : "参加する"}</button></form>{error && <p className="error" role="alert">{error}</p>}</main>;
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
