import { boardExamples } from "@aituber/contracts";
import type { LlmProvider } from "@aituber/providers";
import { boardMarkdownInstruction, boardMarkdownSchema, markdownBoard } from "./blackboard-markdown.ts";
// Held-out topics: these answers are not present in the few-shot examples.
export const boardPreviewInputs=[
 "高校数学。y=x^2+6x+5を平方完成して頂点(-3,-4)を読む。同じ値を足して引く理由を短く補足。",
 "大学数学。部分積分は積の微分から導ける。積分 x cos(x) dx = x sin(x) + cos(x) + C の例を短く説明。",
 "高校生物。DNA→RNA→タンパク質。転写と翻訳の違いを、矢印と要点で短く説明。",
] as const;
export async function previewBoard(provider:LlmProvider,index:number){
 if(!Number.isInteger(index)||index<0||index>=boardPreviewInputs.length)throw new TypeError("example must be 0, 1 or 2");
 const result=await provider.createContext({purpose:"generation",systemInstruction:boardMarkdownInstruction+"Create one board note with its spoken explanation. Return only schema data."}).generate<{blackboardMarkdown:string;text:string}>({
  schemaName:"blackboard_rehearsal",schema:{type:"object",additionalProperties:false,required:["blackboardMarkdown","text"],properties:{blackboardMarkdown:{...boardMarkdownSchema,type:"string"},text:{type:"string",minLength:1,maxLength:400}}},
  prompt:boardPreviewInputs[index]!,maxOutputTokens:1200,maxOutputBytes:12000,signal:AbortSignal.timeout(60_000),
 });
 const drawing=markdownBoard(result.value.blackboardMarkdown);
 if(!drawing)throw new Error("LLM did not return a board");
 return {input:boardPreviewInputs[index],drawing,text:result.value.text,model:result.model,latencyMs:result.latencyMs,usage:result.usage,fewShotCount:boardExamples.length};
}
