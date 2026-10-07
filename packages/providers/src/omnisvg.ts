import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { validateBlackboardSvg, type BlackboardToolCall, type SvgProvider } from "./svg.ts";

/** Fit the complete specialist drawing as one object; never synthesize labels or rearrange paths. */
export function fitOmniSvg(svg: string): string {
  if (typeof svg !== "string" || svg.length > 250_000 || /<!|<\?/.test(svg)) throw new Error("Invalid OmniSVG output");
  const doc = new DOMParser({onError:()=>{throw new Error("Malformed OmniSVG");}}).parseFromString(svg,"image/svg+xml");
  const root=doc.documentElement;
  if (!root || root.tagName!=="svg") throw new Error("Missing SVG root");
  const box=root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!box || box.length!==4 || !box.every(Number.isFinite) || box[2]!<=0 || box[3]!<=0) throw new Error("Invalid OmniSVG viewBox");
  const [x,y,width,height]=box as [number,number,number,number];
  const scale=Math.min(1440/width,740/height);
  const group=doc.createElementNS("http://www.w3.org/2000/svg","g");
  group.setAttribute("transform",`translate(${(1600-width*scale)/2} ${(900-height*scale)/2}) scale(${scale}) translate(${-x} ${-y})`);
  while (root.firstChild) group.appendChild(root.firstChild);
  root.appendChild(group); root.setAttribute("viewBox","0 0 1600 900");
  return validateBlackboardSvg(new XMLSerializer().serializeToString(doc));
}
export class OmniSvgProvider implements SvgProvider {
  readonly supportsAppend=false;
  private readonly endpoint: string;
  constructor(private readonly options: {endpoint?:string;fetch?:typeof fetch} = {}) {
    const url=new URL(options.endpoint ?? "http://127.0.0.1:4314/v1/svg");
    if (url.protocol!=="http:" || !["127.0.0.1","localhost","[::1]"].includes(url.hostname) || url.username || url.password) throw new Error("OmniSVG endpoint must be local HTTP");
    this.endpoint=url.href;
  }
  async generate(call:BlackboardToolCall,signal:AbortSignal):Promise<string> {
    signal.throwIfAborted();
    if (call.name!=="draw_blackboard" || call.arguments.mode!=="replace") throw new Error("OmniSVG currently supports replacement drawings only");
    const response=await (this.options.fetch ?? fetch)(this.endpoint,{
      method:"POST",headers:{"content-type":"application/json"},signal:AbortSignal.any([signal,AbortSignal.timeout(90_000)]),
      body:JSON.stringify({purpose:call.arguments.purpose,requirements:call.arguments.requirements}),
    });
    if (!response.ok) {await response.body?.cancel();throw new Error(`OmniSVG local service HTTP ${response.status}`);}
    const reader=response.body?.getReader(); if (!reader) throw new Error("Empty OmniSVG response");
    let size=0; const chunks:Uint8Array[]=[];
    try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>500_000)throw new Error("OmniSVG response too large");chunks.push(part.value);}}
    finally {await reader.cancel();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const result=JSON.parse(new TextDecoder().decode(bytes)) as {svg?:string};signal.throwIfAborted();
    return fitOmniSvg(result.svg ?? "");
  }
}
