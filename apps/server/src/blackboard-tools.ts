import { createHash } from "node:crypto";
import { mkdir, writeFile } from "@aituber/runtime-platform/files-async";
import { join } from "node:path";
import type { BlackboardDrawing } from "@aituber/contracts";
import { validateBlackboardSvg, type BlackboardToolCall, type SvgProvider } from "@aituber/providers";

export const blackboardToolSchema = { type: ["object", "null"], additionalProperties: false, required: ["name", "arguments"], properties: {
  name: { const: "draw_blackboard" }, arguments: { type: "object", additionalProperties: false, required: ["purpose", "requirements", "mode"], properties: {
    purpose: { type: "string", minLength: 1, maxLength: 300 }, requirements: { type: "string", minLength: 1, maxLength: 4000 }, mode: { enum: ["replace", "append"] },
  } },
} };
export class BlackboardTools {
  private readonly provider: SvgProvider;
  private readonly directory: string;
  constructor(provider: SvgProvider, directory: string) { this.provider = provider; this.directory = directory; }
  get supportsAppend() { return this.provider.supportsAppend !== false; }
  get schema() {
    return {...blackboardToolSchema,properties:{...blackboardToolSchema.properties,arguments:{...blackboardToolSchema.properties.arguments,properties:{...blackboardToolSchema.properties.arguments.properties,mode:{enum:this.supportsAppend ? ["replace","append"] : ["replace"]}}}}};
  }
  async execute(call: BlackboardToolCall, signal: AbortSignal, previous?: BlackboardDrawing): Promise<BlackboardDrawing> {
    if (call.arguments.mode === "append" && !this.supportsAppend) throw new Error("This SVG provider does not support append");
    const svg = validateBlackboardSvg(await this.provider.generate(call, signal, previous?.svg));
    signal.throwIfAborted();
    const id = `blackboard.${createHash("sha256").update(svg).digest("hex")}`;
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, `${id}.svg`), svg, { mode: 0o600 });
    signal.throwIfAborted();
    return { id, svg, purpose: call.arguments.purpose };
  }
}
