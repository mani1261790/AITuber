import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export const STUDY_FORMAT = "aituber-usability-v1" as const;
export const UNIVERSITY_COURSE = "course.vae-reparameterization" as const;
export const HIGH_SCHOOL_COURSES = ["course.quadratic-functions", "course.dna-replication"] as const;
const TASKS = ["join", "submitQuestion", "reconnect", "finish"] as const;
const RATINGS = ["operationEase", "contentClarity", "questionHelpfulness", "rejoinNaturalness"] as const;

type CourseId = typeof UNIVERSITY_COURSE | typeof HIGH_SCHOOL_COURSES[number];
type Level = "high-school" | "university";
type TaskName = typeof TASKS[number];
type RatingName = typeof RATINGS[number];
type CompletionValue = boolean | number | null;

export interface StudyRecord {
  readonly format: typeof STUDY_FORMAT;
  readonly participantId: string;
  readonly createdAt: string;
  readonly consent: { readonly adult18OrOlder: boolean; readonly agreed: boolean; readonly consentedAt: string };
  readonly sessions: readonly CourseStudySession[];
  readonly incidents: readonly StudyIncident[];
}

export interface CourseStudySession {
  readonly courseId: CourseId;
  readonly level: Level;
  readonly classroomCode: string;
  readonly tasks: Readonly<Record<TaskName, { readonly success: boolean | null; readonly assistanceCount: number | null }>>;
  readonly checkpointCorrect: boolean | null;
  readonly ratings: Readonly<Record<RatingName, number | null>>;
}

export interface StudyIncident {
  readonly severity: "critical" | "blocking" | "major" | "minor";
  readonly status: "open" | "resolved";
  readonly summary: string;
  readonly issue: number | null;
}

export interface StudySummary {
  readonly participants: number;
  readonly sessions: number;
  readonly readyForPublicRelease: boolean;
  readonly gates: readonly { readonly label: string; readonly passed: boolean; readonly value: string }[];
  readonly taskSuccess: Readonly<Record<TaskName, number>>;
  readonly medianRatings: Readonly<Record<RatingName, number>>;
  readonly checkpointAccuracy: number;
  readonly incidents: readonly StudyIncident[];
}

export function createStudyRecord(participantId: string, now = new Date()): StudyRecord {
  assertParticipantId(participantId);
  const numericId = Number(participantId.slice(1));
  const highSchoolCourse = HIGH_SCHOOL_COURSES[(numericId - 1) % HIGH_SCHOOL_COURSES.length]!;
  const courseIds: readonly CourseId[] = numericId % 2 === 0 ? [UNIVERSITY_COURSE, highSchoolCourse] : [highSchoolCourse, UNIVERSITY_COURSE];
  return {
    format: STUDY_FORMAT,
    participantId,
    createdAt: now.toISOString(),
    consent: { adult18OrOlder: false, agreed: false, consentedAt: "" },
    sessions: courseIds.map((courseId) => emptySession(courseId)),
    incidents: [],
  };
}

export function validateCompleteRecord(value: unknown): StudyRecord {
  if (!isObject(value) || value.format !== STUDY_FORMAT || typeof value.participantId !== "string") throw new TypeError("Unsupported study record");
  assertParticipantId(value.participantId);
  if (!isObject(value.consent) || value.consent.adult18OrOlder !== true || value.consent.agreed !== true || !validDate(value.consent.consentedAt)) throw new TypeError(`${value.participantId}: consent is incomplete`);
  if (!Array.isArray(value.sessions) || value.sessions.length !== 2) throw new TypeError(`${value.participantId}: exactly two course sessions are required`);
  const sessions = value.sessions.map((session, index) => validateSession(session, `${value.participantId}.sessions[${index}]`));
  if (sessions.filter((session) => session.level === "high-school").length !== 1 || sessions.filter((session) => session.level === "university").length !== 1) throw new TypeError(`${value.participantId}: one high-school and one university session are required`);
  if (!Array.isArray(value.incidents)) throw new TypeError(`${value.participantId}: incidents must be an array`);
  const incidents = value.incidents.map((incident, index) => validateIncident(incident, `${value.participantId}.incidents[${index}]`));
  return { ...value, sessions, incidents } as StudyRecord;
}

export function summarizeStudy(records: readonly StudyRecord[]): StudySummary {
  if (records.length < 6 || records.length > 10) throw new TypeError(`6 to 10 complete participants are required; found ${records.length}`);
  const ids = records.map((record) => record.participantId);
  if (new Set(ids).size !== ids.length) throw new TypeError("Participant IDs must be unique");
  const complete = records.map(validateCompleteRecord);
  const sessions = complete.flatMap((record) => record.sessions);
  const taskSuccess = Object.fromEntries(TASKS.map((task) => [task, ratio(sessions.map((session) => session.tasks[task].success))])) as Record<TaskName, number>;
  const medianRatings = Object.fromEntries(RATINGS.map((rating) => [rating, median(sessions.map((session) => session.ratings[rating] as number))])) as Record<RatingName, number>;
  const checkpointAccuracy = ratio(sessions.map((session) => session.checkpointCorrect));
  const incidents = complete.flatMap((record) => record.incidents);
  const unresolvedReleaseBlockers = incidents.filter((incident) => incident.status === "open" && (incident.severity === "critical" || incident.severity === "blocking"));
  const gates = [
    { label: "参加者6〜10人", passed: complete.length >= 6 && complete.length <= 10, value: `${complete.length}人` },
    { label: "全員が高校・大学教材を評価", passed: sessions.length === complete.length * 2, value: `${sessions.length}/${complete.length * 2}セッション` },
    ...TASKS.map((task) => ({ label: `${task}成功率90%以上`, passed: taskSuccess[task] >= 0.9, value: percent(taskSuccess[task]) })),
    { label: "操作しやすさ中央値4/5以上", passed: medianRatings.operationEase >= 4, value: `${medianRatings.operationEase}/5` },
    { label: "理解しやすさ中央値4/5以上", passed: medianRatings.contentClarity >= 4, value: `${medianRatings.contentClarity}/5` },
    { label: "未解消の致命的・公開阻害事項なし", passed: unresolvedReleaseBlockers.length === 0, value: `${unresolvedReleaseBlockers.length}件` },
  ];
  return { participants: complete.length, sessions: sessions.length, readyForPublicRelease: gates.every((gate) => gate.passed), gates, taskSuccess, medianRatings, checkpointAccuracy, incidents };
}

export function renderSummary(summary: StudySummary, generatedAt = new Date()): string {
  const incidentRows = summary.incidents.length === 0 ? "| なし | - | - | - |" : summary.incidents.map((item) => `| ${escapeCell(item.summary)} | ${item.severity} | ${item.status} | ${item.issue ?? "-"} |`).join("\n");
  return `# AITuber ユーザビリティ評価 集計\n\n生成: ${generatedAt.toISOString()}\n\n製品公開判断: **${summary.readyForPublicRelease ? "公開準備へ進める" : "公開を保留する"}**\n\n## 対象\n\n- 参加者: ${summary.participants}人\n- 評価セッション: ${summary.sessions}件\n- 高校教材と大学教材を各参加者が1本ずつ評価\n\n## 公開ゲート\n\n| 項目 | 結果 | 値 |\n|---|---|---|\n${summary.gates.map((gate) => `| ${gate.label} | ${gate.passed ? "合格" : "未達"} | ${gate.value} |`).join("\n")}\n\n## 指標\n\n- 参加成功率: ${percent(summary.taskSuccess.join)}\n- 質問送信成功率: ${percent(summary.taskSuccess.submitQuestion)}\n- 再接続成功率: ${percent(summary.taskSuccess.reconnect)}\n- 完走率: ${percent(summary.taskSuccess.finish)}\n- 確認問題正答率: ${percent(summary.checkpointAccuracy)}\n- 操作しやすさ中央値: ${summary.medianRatings.operationEase}/5\n- 理解しやすさ中央値: ${summary.medianRatings.contentClarity}/5\n- 質問後の理解中央値: ${summary.medianRatings.questionHelpfulness}/5\n- 本編復帰の自然さ中央値: ${summary.medianRatings.rejoinNaturalness}/5\n\n## 発見事項\n\n| 内容 | 重大度 | 状態 | Issue |\n|---|---|---|---|\n${incidentRows}\n`;
}

export async function recordStudyWithPrompts(draft: StudyRecord, ask: (question: string) => Promise<string>, now = new Date()): Promise<StudyRecord> {
  const record = structuredClone(draft) as Mutable<StudyRecord>;
  if (!await yesNo(ask, "参加者は18歳以上ですか [y/n]: ")) throw new TypeError("Adult eligibility was not confirmed; record unchanged");
  if (!await yesNo(ask, "同意説明を読み、参加に同意しましたか [y/n]: ")) throw new TypeError("Consent was not provided; record unchanged");
  record.consent = { adult18OrOlder: true, agreed: true, consentedAt: now.toISOString() };
  for (let index = 0; index < record.sessions.length; index += 1) {
    const session = record.sessions[index]!;
    process.stdout.write(`\n教材 ${index + 1}/2: ${courseLabel(session.courseId)}\n`);
    session.classroomCode = await nonEmpty(ask, "教室コード: ", 32);
    for (const task of TASKS) {
      session.tasks[task].success = await yesNo(ask, `${taskLabel(task)}に成功しましたか [y/n]: `);
      session.tasks[task].assistanceCount = await integer(ask, "具体的な操作介助の回数 [0以上]: ", 0, 99);
    }
    session.checkpointCorrect = await yesNo(ask, "確認問題は正解でしたか [y/n]: ");
    for (const rating of RATINGS) session.ratings[rating] = await integer(ask, `${ratingLabel(rating)} [1-5]: `, 1, 5);
  }
  while (await yesNo(ask, "発見事項を追加しますか [y/n]: ")) {
    const severity = await choice(ask, "重大度 [critical/blocking/major/minor]: ", ["critical", "blocking", "major", "minor"] as const);
    const summary = await nonEmpty(ask, "個人情報を除いた内容 [300文字以内]: ", 300);
    const status = await yesNo(ask, "修正と再検証が完了していますか [y/n]: ") ? "resolved" : "open";
    const issueText = (await ask("GitHub Issue番号 [なければ空欄]: ")).trim();
    const issue = issueText ? parseInteger(issueText, 1, Number.MAX_SAFE_INTEGER, "Issue number") : null;
    record.incidents.push({ severity, status, summary, issue });
  }
  return validateCompleteRecord(record);
}

async function main() {
  const arguments_ = process.argv.slice(2).filter((value) => value !== "--");
  const command = arguments_[0] ?? "status";
  const studyRoot = resolve(process.env.AITUBER_STUDY_PATH ?? ".data/usability-study");
  if (command === "new") {
    const participantId = arguments_[1] ?? ""; const record = createStudyRecord(participantId);
    const rawDirectory = join(studyRoot, "raw"); await mkdir(rawDirectory, { recursive: true, mode: 0o700 });
    const path = join(rawDirectory, `${participantId}.json`); await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 }); process.stdout.write(`${path}\n`); return;
  }
  if (command === "record") {
    const participantId = arguments_[1] ?? ""; assertParticipantId(participantId); const path = join(studyRoot, "raw", `${participantId}.json`);
    const draft = JSON.parse(await readFile(path, "utf8")) as StudyRecord;
    const prompt = createInterface({ input: process.stdin }); const answers = prompt[Symbol.asyncIterator]();
    try {
      const record = await recordStudyWithPrompts(draft, async (question) => { process.stdout.write(question); const answer = await answers.next(); if (answer.done) throw new TypeError("Input ended before the record was complete"); return answer.value; });
      const temporaryPath = `${path}.tmp-${process.pid}`; await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 }); await rename(temporaryPath, path);
      process.stdout.write(`\nRecorded ${participantId}: ${path}\n`);
    } finally { prompt.close(); }
    return;
  }
  if (command === "delete") {
    const participantId = arguments_[1] ?? ""; assertParticipantId(participantId); await rm(join(studyRoot, "raw", `${participantId}.json`)); process.stdout.write(`Deleted ${participantId}\n`); return;
  }
  if (command === "delete-raw") {
    await readFile(join(studyRoot, "summary.md")); await rm(join(studyRoot, "raw"), { recursive: true }); process.stdout.write("Deleted raw study records\n"); return;
  }
  const { valid, errors } = await loadRecords(join(studyRoot, "raw"));
  if (command === "status") { process.stdout.write(`Complete: ${valid.length}/6 minimum\n${errors.map((error) => `- ${error}\n`).join("")}`); return; }
  if (command === "summarize") {
    if (errors.length) throw new TypeError(`Incomplete records:\n${errors.join("\n")}`);
    const markdown = renderSummary(summarizeStudy(valid)); await mkdir(studyRoot, { recursive: true, mode: 0o700 }); await writeFile(join(studyRoot, "summary.md"), markdown, { mode: 0o600 }); process.stdout.write(`${join(studyRoot, "summary.md")}\n`); return;
  }
  throw new TypeError("Usage: usability-study.ts new <p01> | record <p01> | status | summarize | delete <p01> | delete-raw");
}

async function loadRecords(rawDirectory: string) {
  const valid: StudyRecord[] = []; const errors: string[] = [];
  let names: string[]; try { names = (await readdir(rawDirectory)).filter((name) => name.endsWith(".json")).sort(); } catch { return { valid, errors: ["No participant records yet"] }; }
  for (const name of names) { try { valid.push(validateCompleteRecord(JSON.parse(await readFile(join(rawDirectory, name), "utf8")))); } catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : "invalid record"}`); } }
  return { valid, errors };
}

function emptySession(courseId: CourseId): CourseStudySession {
  const task = () => ({ success: null, assistanceCount: null });
  return { courseId, level: courseId === UNIVERSITY_COURSE ? "university" : "high-school", classroomCode: "", tasks: { join: task(), submitQuestion: task(), reconnect: task(), finish: task() }, checkpointCorrect: null, ratings: { operationEase: null, contentClarity: null, questionHelpfulness: null, rejoinNaturalness: null } };
}

type Mutable<T> = { -readonly [P in keyof T]: T[P] extends readonly (infer U)[] ? Mutable<U>[] : T[P] extends object ? Mutable<T[P]> : T[P] };

function validateSession(value: unknown, path: string): CourseStudySession {
  if (!isObject(value) || !isCourseId(value.courseId) || value.level !== (value.courseId === UNIVERSITY_COURSE ? "university" : "high-school") || typeof value.classroomCode !== "string" || !value.classroomCode.trim() || value.classroomCode.length > 32 || !isObject(value.tasks) || !isObject(value.ratings)) throw new TypeError(`${path}: course session is incomplete`);
  for (const task of TASKS) { const item = value.tasks[task]; if (!isObject(item) || typeof item.success !== "boolean" || !nonNegativeInteger(item.assistanceCount)) throw new TypeError(`${path}.tasks.${task}: result is incomplete`); }
  if (typeof value.checkpointCorrect !== "boolean") throw new TypeError(`${path}.checkpointCorrect is incomplete`);
  for (const rating of RATINGS) if (!integerInRange(value.ratings[rating], 1, 5)) throw new TypeError(`${path}.ratings.${rating} must be 1 to 5`);
  return value as unknown as CourseStudySession;
}

function validateIncident(value: unknown, path: string): StudyIncident {
  if (!isObject(value) || !["critical", "blocking", "major", "minor"].includes(String(value.severity)) || !["open", "resolved"].includes(String(value.status)) || typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 300 || !(value.issue === null || nonNegativeInteger(value.issue))) throw new TypeError(`${path}: incident is invalid`);
  return value as unknown as StudyIncident;
}

function assertParticipantId(value: string) { if (!/^p(?:0[1-9]|10)$/.test(value)) throw new TypeError("Participant ID must be p01 through p10"); }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isCourseId(value: unknown): value is CourseId { return value === UNIVERSITY_COURSE || HIGH_SCHOOL_COURSES.includes(value as typeof HIGH_SCHOOL_COURSES[number]); }
function validDate(value: unknown) { return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value)); }
function nonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function integerInRange(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function ratio(values: readonly CompletionValue[]) { return values.filter((value) => value === true).length / values.length; }
function median(values: readonly number[]) { const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2; }
function percent(value: number) { return `${Math.round(value * 1000) / 10}%`; }
function escapeCell(value: string) { return value.replaceAll("|", "\\|").replaceAll("\n", " "); }
async function yesNo(ask: (question: string) => Promise<string>, question: string): Promise<boolean> { while (true) { const value = (await ask(question)).trim().toLowerCase(); if (value === "y" || value === "yes") return true; if (value === "n" || value === "no") return false; process.stdout.write("y または n を入力してください。\n"); } }
async function integer(ask: (question: string) => Promise<string>, question: string, minimum: number, maximum: number): Promise<number> { while (true) { const value = (await ask(question)).trim(); try { return parseInteger(value, minimum, maximum, "value"); } catch { process.stdout.write(`${minimum}〜${maximum}の整数を入力してください。\n`); } } }
function parseInteger(value: string, minimum: number, maximum: number, name: string): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`); return parsed; }
async function nonEmpty(ask: (question: string) => Promise<string>, question: string, maximum: number): Promise<string> { while (true) { const value = (await ask(question)).trim(); if (value && value.length <= maximum) return value; process.stdout.write(`1〜${maximum}文字で入力してください。\n`); } }
async function choice<const T extends readonly string[]>(ask: (question: string) => Promise<string>, question: string, values: T): Promise<T[number]> { while (true) { const value = (await ask(question)).trim(); if (values.includes(value)) return value as T[number]; process.stdout.write(`${values.join(" / ")}から選んでください。\n`); } }
function courseLabel(courseId: CourseId) { return courseId === "course.quadratic-functions" ? "高校数学・二次関数" : courseId === "course.dna-replication" ? "高校生物・DNA複製" : "大学・VAEの再パラメータ化"; }
function taskLabel(task: TaskName) { return ({ join: "教室参加", submitQuestion: "質問送信", reconnect: "再接続", finish: "授業完走" } as const)[task]; }
function ratingLabel(rating: RatingName) { return ({ operationEase: "必要な操作を迷わず行えた", contentClarity: "講義内容を理解しやすかった", questionHelpfulness: "質問した箇所を理解しやすくなった", rejoinNaturalness: "本編へ自然に戻れた" } as const)[rating]; }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
