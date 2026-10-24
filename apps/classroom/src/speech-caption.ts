interface Segment { text: string; startMs: number; endMs: number }

/** Group provider-aligned words into readable cues; never advance on a wall clock. */
export function speechCaption(segments: readonly Segment[], elapsedMs: number, dictionary: readonly {surface: string; reading: string}[] = [], transcript?: string | null, original = false): string {
  const cues: Segment[] = [];
  for (const segment of original ? segments : restoreCaptionPunctuation(segments, transcript)) {
    const previous = cues.at(-1);
    if (previous && previous.text.length + segment.text.length <= 36 && !/[。！？!?]$/.test(previous.text) && segment.startMs - previous.endMs < 500) {
      previous.text += segment.text; previous.endMs = segment.endMs;
    } else cues.push({...segment});
  }
  const cue = cues.find((item, index) => elapsedMs >= item.startMs && elapsedMs < Math.max(item.endMs, cues[index+1]?.startMs ?? item.endMs));
  if (!cue) return "";
  if(original)return cue.text;
  // Display terminology as written in the material, not as TTS kana.
  const readings = [{surface:"Large Language Model",reading:"ラージ・ランゲージ・モデル"},{surface:"LLM",reading:"エルエルエム"},...dictionary].sort((a,b)=>b.reading.length-a.reading.length);
  return readings.reduce((text, entry) => {
    const compact=entry.reading.replace(/[・\s]/gu,"");
    return compact ? text.replaceAll(entry.reading,entry.surface).replaceAll(compact,entry.surface) : text;
  },cue.text);
}

/** Fish word alignment omits punctuation; recover it from the synthesized text. */
function restoreCaptionPunctuation(segments: readonly Segment[], transcript?: string | null): readonly Segment[] {
  if (!transcript) return segments;
  const ignored = /[\s。、！？!?・]/u;
  let normalized = "";
  const offsets: number[] = [];
  for (let i=0;i<transcript.length;i++) {
    const char=transcript[i]!;
    if (ignored.test(char)) continue;
    const value=char.normalize("NFKC").toLowerCase();
    normalized+=value;
    for(let j=0;j<value.length;j++) offsets.push(i);
  }
  let cursor=0;
  const starts=segments.map(segment=>{
    const text=[...segment.text].filter(char=>!ignored.test(char)).join("").normalize("NFKC").toLowerCase();
    if(!text)return null;
    const found=normalized.indexOf(text,cursor);
    if(found<0)return null;
    cursor=found+text.length;
    return offsets[found] ?? null;
  });
  // A mismatch is not permission to invent alignment for unmatched words.
  if(starts.some(start=>start===null))return segments;
  return segments.map((segment,index)=>({...segment,text:transcript.slice(starts[index]!,starts[index+1] ?? transcript.length)}));
}
