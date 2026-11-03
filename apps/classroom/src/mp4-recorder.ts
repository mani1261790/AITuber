import {observeSlideMedia} from "./pdf-media.ts";
export function mp4RecordingType(supported:(mime:string)=>boolean=type=>typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported(type)){
 return ['video/mp4;codecs=avc1,mp4a.40.2','video/mp4;codecs=avc1.42E01E,mp4a.40.2'].find(supported)??null;
}
/** Only the rendered lesson canvas and its audio; never microphone or desktop capture. */
export async function recordLessonMp4(canvas:HTMLCanvasElement,audio:HTMLAudioElement,onFailure:(message:string)=>void){
 const mimeType=mp4RecordingType();if(!mimeType)throw Error('このブラウザはMP4書き出しに対応していません。ChromeまたはSafariで開いてください。');
 let unobserve=()=>{};const extra=new Map<HTMLVideoElement,MediaElementAudioSourceNode>();
 const context=new AudioContext();let source:MediaElementAudioSourceNode;let stream:MediaStream;
 try{await context.resume();source=context.createMediaElementSource(audio);const destination=context.createMediaStreamDestination();source.connect(destination);source.connect(context.destination);unobserve=observeSlideMedia((video,added)=>{if(added){const node=context.createMediaElementSource(video);extra.set(video,node);node.connect(destination);node.connect(context.destination);}else{extra.get(video)?.disconnect();extra.delete(video);}});const video=canvas.captureStream(30);stream=new MediaStream([...video.getVideoTracks(),...destination.stream.getAudioTracks()]);}catch(error){await context.close();throw error;}
 let recorder:MediaRecorder;try{recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:4_000_000,audioBitsPerSecond:160_000});}catch(error){stream.getTracks().forEach(t=>t.stop());source.disconnect();await context.close();throw error;}
 const chunks:Blob[]=[];let size=0,failed=false,stopped=false;let resolve:(blob:Blob)=>void,reject:(error:Error)=>void;const result=new Promise<Blob>((ok,no)=>{resolve=ok;reject=no;});void result.catch(()=>{});
 const cleanup=()=>{unobserve();for(const node of extra.values())node.disconnect();extra.clear();stream.getTracks().forEach(t=>t.stop());source.disconnect();void context.close();};
 const fail=(message:string)=>{if(failed||stopped)return;failed=true;onFailure(message);if(recorder.state!=='inactive')recorder.stop();else{cleanup();reject(Error(message));}};
 recorder.ondataavailable=e=>{if(!e.data.size)return;size+=e.data.size;if(size>512*1024*1024){fail('動画が512MBを超えました。短い教材に分けて書き出してください。');return;}chunks.push(e.data);};
 recorder.onerror=()=>fail('MP4の収録に失敗しました。');
 recorder.onstop=()=>{stopped=true;cleanup();if(failed||!chunks.length){chunks.length=0;reject(Error('MP4の書き出しを中止しました。'));}else{const blob=new Blob(chunks,{type:'video/mp4'});chunks.length=0;resolve(blob);}};
 try{recorder.start(1000);}catch(error){cleanup();throw error;}
 return {result,pause(){if(recorder.state==='recording')recorder.pause();},resume(){if(recorder.state==='paused')recorder.resume();},stop(){if(recorder.state!=='inactive')recorder.stop();},cancel(){fail('書き出しを中止しました。');},get state(){return recorder.state;}};
}
