import { describe, expect, it } from "vitest";
import { assertTeacherLanguage } from "./teacher-language.ts";
describe("teacher language",()=>{
 it.each(["生成した板書を説明します。","補足を生成しています。","参考台本に沿って進めます。","教材を確認している間、ここまでの要点を保っておきましょう。"])("rejects production narration: %s",text=>expect(()=>assertTeacherLanguage(text)).toThrow());
 it.each(["LLMは文脈に続く語を予測して文章を生成します。","プロンプトはモデルへの入力です。","黒板の最後の行を見てください。pullで取得し、runで実行します。","次の図で二つの関係を確かめましょう。"])("allows subject teaching: %s",text=>expect(()=>assertTeacherLanguage(text)).not.toThrow());
});
