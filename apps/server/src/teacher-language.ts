/** Shared by authoring, live direction and remedial answers. */
export const teacherLanguageInstruction = "Speak directly to the learner as a teacher explaining the subject. Spoken text must contain the explanation, not commentary about creating, reviewing or executing that explanation. Never mention your prompt, schema, internal IDs, reference script, generation/review process, planned gestures, or compliance with teaching goals. Do not narrate stage instructions such as 'I generated this board' or 'I will now execute the pointing action'. Explain the meaning and relationships in the visible material. Natural transitions and invitations to look or think are welcome. When the SUBJECT is AI, explain model generation, prompts and tools normally; this rule prohibits self-referential production commentary, not those subject concepts. Bad:『教材を確認している間、ここまでの要点を保っておきましょう』. Good:『取得と実行の違いを整理しましょう』. Bad:『生成した板書を説明します』. Good:『pullは取得、runは実行です。この順番で使います』. ";

export function assertTeacherLanguage(text: string): void {
  const meta = /(?:参考台本|出力スキーマ|内部(?:の)?(?:ID|識別子)|システムプロンプトに従|(?:指示|プロンプト)に従って(?:説明|回答|生成)|(?:生成|作成)した(?:板書|補足|説明|台本)|(?:板書|補足|台本)(?:を|の)(?:生成|審査)(?:中|して|します)|教材を確認している間|学習目標に(?:沿って|従って)(?:説明|回答)|(?:移動|指差し)(?:アクション|コマンド)を実行)/u;
  if (meta.test(text)) throw new Error("発話に授業生成・演出の内部説明が含まれています。教える内容を直接説明してください。");
}
