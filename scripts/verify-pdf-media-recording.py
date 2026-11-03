from pathlib import Path
import json,wave,numpy as np
D=Path(__file__).resolve().parents[1]/'output/pdf-media'
with wave.open(str(D/'export-audio.wav')) as w:sr=w.getframerate();x=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(float)/32768
stats=[]
for sec in range(int(len(x)/sr)):
 chunk=x[sec*sr:(sec+1)*sr];a=np.abs(np.fft.rfft(chunk*np.hanning(len(chunk))));tone=float(a[880]*4/sr);stats.append({'second':sec,'tone880Amplitude':tone,'nearbyPeakHz':int(np.argmax(a[850:910])+850)})
rows=json.loads((D/'telemetry.json').read_text());paused=[r for r in rows if '再開' in r['status']];resumed=next(r for r in rows if r['wall']>paused[-1]['wall'] and r.get('src') and not r['paused']);active=[r for r in rows if r.get('src') and not r['paused'] and r['video']>0]
# speech-video offset stays constant in each utterance; expected cue begins at 4.6s in the first speech.
by={}
for r in active:by.setdefault(r['src'],[]).append(r['audio']-r['video'])
report={'status':json.loads((D/'final-session.json').read_text())['session']['status'],'completed':json.loads((D/'final-session.json').read_text())['session']['progress'],'pauseDurationMs':paused[-1]['wall']-paused[0]['wall'],'pausedVideoRangeSeconds':[min(r['video'] for r in paused),max(r['video'] for r in paused)],'resumePositionDifferenceSeconds':resumed['video']-paused[-1]['video'],'syncOffsetsSeconds':[{'median':float(np.median(v)),'p95Deviation':float(np.percentile(np.abs(np.array(v)-np.median(v)),95))} for v in by.values()],'embeddedToneSeconds':[s['second'] for s in stats if s['nearbyPeakHz']==880 and s['tone880Amplitude']>.004],'mp4DecodeErrors':(D/'decode.log').stat().st_size,'audioSpectrum':stats}
assert report['status']=='FINISHED' and report['completed']['completed']==2
assert report['pausedVideoRangeSeconds'][1]-report['pausedVideoRangeSeconds'][0]<.01
assert abs(report['resumePositionDifferenceSeconds'])<.1
assert len(report['embeddedToneSeconds'])>10
assert report['mp4DecodeErrors']==0
(D/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='audioSpectrum'},ensure_ascii=False,indent=2))
