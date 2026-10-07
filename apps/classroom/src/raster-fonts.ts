import { getFontEmbedCSS } from "html-to-image";

// The rasterizer otherwise scans and embeds the same font data for every slide
// and blackboard. Key by the actual families: later formulas can require KaTeX
// families that were absent in the first slide.
const documents = new WeakMap<Document, Map<string, Promise<string>>>();
export function rasterFontCss(node: HTMLElement): Promise<string> {
  let cache = documents.get(node.ownerDocument);
  if (!cache) { cache = new Map(); documents.set(node.ownerDocument, cache); }
  const families = new Set<string>();
  for (const element of [node, ...node.querySelectorAll("*")]) {
    if (element instanceof HTMLElement) families.add(element.style.fontFamily || getComputedStyle(element).fontFamily);
  }
  const key = JSON.stringify([node.ownerDocument.fonts.size, [...families].sort()]);
  const existing = cache.get(key);
  if (existing) return existing;
  const result = getFontEmbedCSS(node, { preferredFontFormat: "woff2" }).catch(error => { cache!.delete(key); throw error; });
  // Bound retained base64 data while allowing concurrent identical requests to share work.
  if (cache.size >= 6) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
