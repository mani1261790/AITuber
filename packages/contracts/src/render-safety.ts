const FORBIDDEN_TEX_COMMAND = /\\(?:href|url|includegraphics|html(?:Class|Id|Style|Data)|def|gdef|edef|xdef|newcommand|renewcommand|providecommand|catcode|require)\b/i;
const MARKUP_TAG = /<\s*\/?\s*(?:script|style|svg|math|iframe|object|embed|img|link|meta)\b/i;

export function isSafeFormulaInput(value: string): boolean {
  return typeof value === "string" && value.length <= 4_096 && !FORBIDDEN_TEX_COMMAND.test(value) && !MARKUP_TAG.test(value) && !hasUnsafeControl(value);
}

export function assertSafeFormulaInput(value: string): void {
  if (!isSafeFormulaInput(value)) throw new TypeError("formula contains unsafe or unsupported rendering input");
}

function hasUnsafeControl(value: string): boolean {
  return [...value].some((character) => { const code = character.charCodeAt(0); return (code < 32 && character !== "\n" && character !== "\t") || code === 127; });
}
