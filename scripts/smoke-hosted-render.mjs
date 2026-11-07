// Exercise the real Chromium/PDF/ffmpeg pipeline without accessing any production course or secret.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {compileExportUnits} from '../apps/server/dist/video-export-service.js';
import {actionSpeechTexts} from '../apps/server/dist/lesson-director.js';
const dir=process.argv[2],course=JSON.parse(fs.readFileSync('fixtures/pdf-media/cloud-course.json'));
const units=compileExportUnits(course).slice(0,1),speeches={};
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=2','-y',path.join(dir,'tone.wav')]);
for(const text of new Set(units.flatMap(u=>actionSpeechTexts(u.actions))))speeches[text]={file:'tone.wav',durationMs:2000,segments:[{text,startMs:0,endMs:2000}]};
fs.writeFileSync(path.join(dir,'input.json'),JSON.stringify({course,units,speeches,sourceUrls:Object.fromEntries(course.sources.filter(s=>s.kind==='pdf').map(s=>[s.id,'/job/video-slides.pdf'])),fps:30}));
fs.writeFileSync(path.join(dir,'status.json'),'{}');
execFileSync(process.execPath,['scripts/render-mp4-worker.mjs',dir],{stdio:'inherit'});
const job=JSON.parse(fs.readFileSync(path.join(dir,'status.json')));if(job.status!=='complete'||!(job.frames>=60))throw Error(job.error??'Incomplete render');
const tl=JSON.parse(fs.readFileSync(path.join(dir,'timeline.json')));if(!tl.media.length||!tl.audio.some(t=>t.file.endsWith('.mp4')))throw Error('Embedded PDF video/audio missing');
execFileSync('ffmpeg',['-v','error','-xerror','-i',path.join(dir,'lecture.mp4'),'-f','null','-'],{stdio:'inherit'});console.log('Decoded hosted PDF video and audio:',job.frames,'frames');
