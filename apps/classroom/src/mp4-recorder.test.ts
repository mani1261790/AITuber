import {expect,it} from 'vitest';import {mp4RecordingType} from './mp4-recorder.ts';
it('requires genuine MP4 with H264 and AAC rather than relabeling a WebM',()=>{expect(mp4RecordingType(m=>m==='video/mp4;codecs=avc1,mp4a.40.2')).toBe('video/mp4;codecs=avc1,mp4a.40.2');expect(mp4RecordingType(m=>m.startsWith('video/webm'))).toBeNull();});
