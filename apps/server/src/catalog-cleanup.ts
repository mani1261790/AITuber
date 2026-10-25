import {existsSync,readFileSync,readdirSync,unlinkSync,writeFileSync} from '@aituber/runtime-platform/files';
import {join} from 'node:path';
import {digest} from './prepared-artifacts.ts';

export const legacyCourseIds = ['course.quadratic-functions','course.dna-replication','course.vae-reparameterization','percent-ratio-elementary','completing-square-vertex-reading'] as const;
const retainedId='local-llm-ollama-intro';
type Source={contentHash:string};
type SavedJob={candidate?:{id:string};inputs:{sources:Source[]}};
/** Explicit, one-time removal of the operator's legacy sample catalog. */
export async function purgeLegacyCatalog(root:string,deleteSources:(hashes:string[])=>Promise<void>){
 const authoring=join(root,'authoring'),prepared=join(root,'llm-settings.json.prepared');
 const publishedPath=join(prepared,digest('published:'+retainedId)+'.json');
 if(!existsSync(publishedPath))throw new TypeError('公開済みOllamaパッケージがないため削除できません。');
 const retained=JSON.parse(readFileSync(publishedPath,'utf8'));
 if(retained.id!==retainedId||!retained.performance)throw new TypeError('残すパッケージを確認できません。');
 const keepHashes=new Set<string>(retained.sources.map((source:Source)=>source.contentHash));
 const jobs=readdirSync(authoring).filter(name=>/^authoring\.[\w-]+\.json$/.test(name)).map(name=>({path:join(authoring,name),value:JSON.parse(readFileSync(join(authoring,name),'utf8')) as SavedJob}));
 // A job sharing any retained material is preserved, even if it has no candidate yet.
 const removeJobs=jobs.filter(job=>job.value.candidate?.id!==retainedId && !job.value.inputs.sources.some(source=>keepHashes.has(source.contentHash)));
 for(const job of removeJobs)if(job.value.candidate && !legacyCourseIds.includes(job.value.candidate.id as typeof legacyCourseIds[number]))throw new TypeError('削除対象外の新しい教材があります。対象を再確認してください。');
 const deletedHashes=new Set(removeJobs.flatMap(job=>job.value.inputs.sources.map(source=>source.contentHash)));
 for(const job of jobs.filter(job=>!removeJobs.includes(job)))for(const source of job.value.inputs.sources)deletedHashes.delete(source.contentHash);
 for(const hash of keepHashes)deletedHashes.delete(hash);
 const hashes=[...deletedHashes].map(hash=>{if(!/^sha256:[a-f0-9]{64}$/.test(hash))throw new TypeError('Invalid source hash');return hash.slice(7);});
 // Keep local records intact if external deletion fails; retry is idempotent.
 await deleteSources(hashes);
 for(const hash of hashes)unlinkSync(join(authoring,'sources',hash));
 for(const job of removeJobs)unlinkSync(job.path);
 const preserved=new Set(['published:'+retainedId,'draft:'+retainedId,'package-index'].map(key=>digest(key)+'.json'));
 let removedArtifacts=0;
 for(const name of readdirSync(prepared)){if(preserved.has(name))continue;unlinkSync(join(prepared,name));removedArtifacts++;}
 writeFileSync(join(prepared,digest('package-index')+'.json'),JSON.stringify([retainedId]));
 return {removedJobs:removeJobs.length,removedSources:hashes.length,removedArtifacts,retainedCourseId:retainedId};
}
