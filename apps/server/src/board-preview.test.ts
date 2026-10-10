import {it,expect} from "vitest";
import {FixedResponseLlmProvider} from "@aituber/providers";
import {previewBoard} from "./board-preview.ts";
it("validates live preview indices and generated board notation",async()=>{
 const provider=new FixedResponseLlmProvider([{blackboardMarkdown:"# 検証\n◎ **要点**",text:"要点の説明です。"}]);
 await expect(previewBoard(provider,3)).rejects.toThrow("example");
 const result=await previewBoard(provider,0);expect(result.fewShotCount).toBe(3);expect(result.drawing.markdown).toContain("要点");
 await expect(previewBoard(new FixedResponseLlmProvider([{blackboardMarkdown:"<script>bad</script>",text:"x"}]),0)).rejects.toThrow();
});
