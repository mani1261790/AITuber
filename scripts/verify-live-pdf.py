"""Check browser telemetry and the authenticated final session from a live PDF test."""
import json,sys,statistics
from pathlib import Path
root=Path(sys.argv[1]);data=json.loads((root/'live-trace.json').read_text());session=json.loads((root/'live-final-session.json').read_text())['session'];check=data['pause'];rows=data['trace']
assert check['pauseStatus']==check['resumeStatus']==200
assert not session['speech'].get('failure')
assert check['resumeAt']-check['pauseAt']>=9000
assert session['status']=='FINISHED' and session['progress']['completed']==session['progress']['total']==4
paused=[r for r in rows if r.get('status')=='一時停止中' and check['pauseAt']+500<r['wall']<check['resumeAt']]
assert paused and max(r['video'] for r in paused)-min(r['video'] for r in paused)<.01
played=next(e for e in data['events'] if e['name']=='playing' and e['wall']>check['resumeAt'])
assert abs(played['time']-check['before']['audio'])<.1
video=next(r for r in rows if r['wall']>=played['wall'] and r.get('audio',0)>0 and not r.get('audioPaused',True) and not r.get('videoPaused',True))
assert video['wall']-played['wall']<300
by={}
for r in rows:
 if r.get('audio',0)>0 and r.get('video',0)>0 and not r.get('audioPaused',True) and not r.get('videoPaused',True):by.setdefault(r['src'],[]).append(r['audio']-r['video'])
assert len(by)>=3
sync=[]
for values in by.values():
 median=statistics.median(values);deviations=sorted(abs(v-median) for v in values);p95=deviations[int((len(deviations)-1)*.95)];assert p95<.15
 sync.append({'samples':len(values),'medianSpeechVideoOffsetSeconds':median,'p95DeviationSeconds':p95})
report={'status':session['status'],'progress':session['progress'],'pauseSeconds':(check['resumeAt']-check['pauseAt'])/1000,'pausedVideoRangeSeconds':[min(r['video'] for r in paused),max(r['video'] for r in paused)],'requestedAudioPosition':check['before']['audio'],'resumedAudioPosition':played['time'],'videoResumeDelayMs':video['wall']-played['wall'],'sync':sync}
(root/'live-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
