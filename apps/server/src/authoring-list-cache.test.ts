import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import * as files from '@aituber/runtime-platform/files';
import {CourseAuthoringService} from './course-authoring-service';
vi.mock('@aituber/runtime-platform/files',async importOriginal => {
 const original=await importOriginal<typeof import('@aituber/runtime-platform/files')>();
 return {...original,readFileSync:vi.fn(original.readFileSync),readdirSync:vi.fn(original.readdirSync)};
});
it('serves cached summaries without rereading source checkpoints and keeps changes across restart',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'aituber-list-cache-'));
 const options={directory,cacheViews:true,defer:()=>{},llm:()=>{throw new Error('must not generate');}};
 const service=new CourseAuthoringService(options);
 const job=await service.begin({durationMinutes:5,timeBudgetMs:1000,costBudgetUsd:0,sources:[{fileName:'note.txt',mimeType:'text/plain',dataBase64:Buffer.from('数学の講義用資料').toString('base64'),rights:{basis:'owned'}}]});
 vi.mocked(files.readFileSync).mockClear();vi.mocked(files.readdirSync).mockClear();
 for(let i=0;i<100;i++)expect(service.list()[0]?.status).toBe('running');
 expect(files.readFileSync).not.toHaveBeenCalled();expect(files.readdirSync).not.toHaveBeenCalled();
 service.stop(job.id);expect(service.list()[0]?.status).toBe('stopped');
 const restored=new CourseAuthoringService(options);expect(restored.list()[0]?.status).toBe('stopped');
 const copy=restored.list();Reflect.set(copy[0]!.request,"durationMinutes",99);expect(restored.list()[0]?.request.durationMinutes).toBe(5);
});
