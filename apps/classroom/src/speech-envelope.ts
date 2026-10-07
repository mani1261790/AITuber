/** Per-20ms RMS levels; channel energies are combined without phase cancellation. */
export function speechEnvelope(channels: readonly Float32Array[], sampleRate: number) {
  const size=Math.max(1,Math.round(sampleRate*.02)),length=channels[0]?.length??0;
  const levels=new Float32Array(Math.ceil(length/size));
  for(let frame=0;frame<levels.length;frame++){
    const start=frame*size,end=Math.min(length,start+size);let energy=0;
    for(const channel of channels)for(let i=start;i<end;i++)energy+=(channel[i]??0)**2;
    levels[frame]=Math.sqrt(energy/Math.max(1,(end-start)*channels.length));
  }
  const sorted=Array.from(levels).sort((a,b)=>a-b),reference=Math.max(.04,sorted[Math.floor(sorted.length*.9)]??.04);
  return levels.map(level=>Math.min(.85,Math.sqrt(Math.max(0,level-.008)/reference)*.7));
}
export function levelAt(levels:Float32Array,time:number){
  const index=Math.max(0,time/.02),i=Math.floor(index),fraction=index-i;
  return (levels[i]??0)*(1-fraction)+(levels[i+1]??0)*fraction;
}
