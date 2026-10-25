import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {digest} from './prepared-artifacts.ts';import {purgeLegacyCatalog} from './catalog-cleanup.ts';
const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
function setup(){const root=mkdtempSync(join(tmpdir(),'catalog-purge-'));roots.push(root);const dir=join(root,'authoring'),cache=join(root,'llm-settings.json.prepared');mkdirSync(join(dir,'sources'),{recursive:true});mkdirSync(cache);
 const keep='sha256:'+'a'.repeat(64),remove='sha256:'+'b'.repeat(64);const course={id:'local-llm-ollama-intro',performance:{units:[{text:'preserve'}]},sources:[{contentHash:keep}]};
 for(const prefix of ['published:','draft:'])writeFileSync(join(cache,digest(prefix+course.id)+'.json'),JSON.stringify(course));
 writeFileSync(join(cache,digest('package-index')+'.json'),JSON.stringify([course.id,'percent-ratio-elementary']));writeFileSync(join(cache,'old-cache.json'),'{}');
 for(const [id,hash] of [[course.id,keep],['percent-ratio-elementary',remove]])writeFileSync(join(dir,'authoring.'+id+'.json'),JSON.stringify({candidate:{id},inputs:{sources:[{contentHash:hash}]}}));
 writeFileSync(join(dir,'sources',remove.slice(7)),'pdf');return{root,dir,cache,keep,remove,course};}
it('physically removes legacy jobs/sources/artifacts, preserves the published course byte for byte, and is idempotent',async()=>{
 const f=setup(),path=join(f.cache,digest('published:'+f.course.id)+'.json'),before=readFileSync(path);const remove=vi.fn().mockResolvedValue(undefined);
 expect(await purgeLegacyCatalog(f.root,remove)).toMatchObject({removedJobs:1,removedSources:1,removedArtifacts:1});expect(remove).toHaveBeenCalledWith([f.remove.slice(7)]);
 expect(existsSync(join(f.dir,'authoring.percent-ratio-elementary.json'))).toBe(false);expect(existsSync(join(f.dir,'sources',f.remove.slice(7)))).toBe(false);expect(readFileSync(path)).toEqual(before);
 expect(JSON.parse(readFileSync(join(f.cache,digest('package-index')+'.json'),'utf8'))).toEqual([f.course.id]);expect((await purgeLegacyCatalog(f.root,remove)).removedJobs).toBe(0);
});
it('does not delete local records if R2 deletion fails',async()=>{const f=setup();await expect(purgeLegacyCatalog(f.root,async()=>{throw Error('offline');})).rejects.toThrow('offline');expect(existsSync(join(f.dir,'authoring.percent-ratio-elementary.json'))).toBe(true);});
it('preserves unfinished work sharing the retained PDF',async()=>{const f=setup();writeFileSync(join(f.dir,'authoring.partial.json'),JSON.stringify({inputs:{sources:[{contentHash:f.keep}]}}));await purgeLegacyCatalog(f.root,async()=>{});expect(existsSync(join(f.dir,'authoring.partial.json'))).toBe(true);});
it('refuses unexpected newly created courses before deleting anything',async()=>{const f=setup();writeFileSync(join(f.dir,'authoring.new.json'),JSON.stringify({candidate:{id:'new-course'},inputs:{sources:[{contentHash:f.remove}]}}));const remove=vi.fn();await expect(purgeLegacyCatalog(f.root,remove)).rejects.toThrow('新しい教材');expect(remove).not.toHaveBeenCalled();});
