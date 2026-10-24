interface Segment { text: string; startMs: number; endMs: number }

/** Group provider-aligned words into readable cues; never advance on a wall clock. */
export function speechCaption(segments: readonly Segment[], elapsedMs: number, dictionary: readonly {surface: string; reading: string}[] = []): string {
  const cues: Segment[] = [];
  for (const segment of segments) {
    const previous = cues.at(-1);
    if (previous && previous.text.length + segment.text.length <= 46 && !/[。！？!?]$/.test(previous.text) && segment.startMs - previous.endMs < 500) {
      previous.text += segment.text; previous.endMs = segment.endMs;
    } else cues.push({...segment});
  }
  const cue = cues.find((item, index) => elapsedMs >= item.startMs && elapsedMs < Math.max(item.endMs, cues[index+1]?.startMs ?? item.endMs));
  if (!cue) return "";
  // Display terminology as written in the material, not as TTS kana.
  const readings = [{surface:"Large Language Model",reading:"ラージ・ランゲージ・モデル"},{surface:"LLM",reading:"エルエルエム"},...dictionary].sort((a,b)=>b.reading.length-a.reading.length);
  return readings.reduce((text, entry) => entry.reading ? text.replaceAll(entry.reading,entry.surface) : text,cue.text);
}
