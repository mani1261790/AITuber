"""Verify a background-render job. Optional second job compares slow-render timing."""
import json,sys,subprocess
from pathlib import Path
import numpy as np
job=Path(sys.argv[1]); timeline=json.loads((job/'timeline.json').read_text())
def audio(file):
 return np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(file),'-f','f32le','-ac','1','-ar','6000','pipe:1']),dtype='<f4').astype(float)
out=audio(job/'lecture.mp4');checks=[]
for t in timeline['audio']:
 if not t['file'].startswith('voice-'):continue
 source=audio(job/t['file']);n=min(len(source)-3000,int(t['duration']*6000)-3000);a=source[1500:1500+n];start=round(t['start']*6000)+1500
 candidates=[]
 for lag in range(-200,201):
  b=out[start+lag:start+lag+n]
  if len(b)==len(a):candidates.append((float(np.corrcoef(a,b)[0,1]),lag))
 correlation,lag=max(candidates);checks.append({'start':t['start'],'correlation':correlation,'offsetMs':lag/6})
 assert correlation>.95 and abs(lag/6)<33.34,(correlation,lag)
media=[]
for t in timeline['audio']:
 if not t['file'].startswith('media-'):continue
 detected=[]
 for sec in range(int(t['start'])+1,int(t['start']+t['duration'])-1):
  chunk=out[sec*6000:(sec+1)*6000];spectrum=np.abs(np.fft.rfft(chunk*np.hanning(len(chunk))));peak=int(np.argmax(spectrum[850:910])+850)
  if peak==880 and spectrum[880]*4/6000>.004:detected.append(sec)
 assert len(detected)>=3,detected
 media.append({'start':t['start'],'toneHz':880,'detectedSeconds':detected})

probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-of','json',str(job/'lecture.mp4')]))
v=next(s for s in probe['streams'] if s['codec_type']=='video');assert int(v['nb_read_frames'])==timeline['frames'];assert v['avg_frame_rate']=='30/1'
subprocess.run(['ffmpeg','-v','error','-i',str(job/'lecture.mp4'),'-f','null','-'],check=True)
media_tracks=[track for track in timeline['audio'] if track['file'].startswith('media-')]
for sample in timeline['samples']:
 if not sample.get('media'):continue
 absolute=sample['frame']/timeline['fps']
 for track in media_tracks:
  if track['start']+.05 < absolute < track['start']+track['duration']-.05:
   assert abs(sample['media'][0]['time']-(absolute-track['start']))<1/30+.001

report={'frames':timeline['frames'],'duration':timeline['frames']/timeline['fps'],'voice':checks,'embeddedAudio':media,'decode':'passed','mediaFrameSync':'passed'}
if len(sys.argv)>2:
 slow=json.loads((Path(sys.argv[2])/'timeline.json').read_text())
 for key in ['frames','audio','trace','samples']:assert timeline[key]==slow[key],key
 report['slowRender']={'timingAndMotionIdentical':True,'pixelHashIdentical':timeline['frameSha256']==slow['frameSha256'],'normalWallMs':timeline['wallRenderMs'],'slowWallMs':slow['wallRenderMs']}
(job/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
