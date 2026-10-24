import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from '@aituber/runtime-platform/files';
import {join} from 'node:path';
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Small immutable/revisioned artifacts, written only when preparation changes. */
export class PreparedArtifacts {
 private cache=new Map<string,unknown>();
 private directory:string;
 constructor(directory:string){this.directory=directory;mkdirSync(directory,{recursive:true});}
 private remember(key:string,value:unknown){this.cache.delete(key);this.cache.set(key,value);if(this.cache.size>512)this.cache.delete(this.cache.keys().next().value!);}
 read<T>(key:string):T|null {
  if(this.cache.has(key))return structuredClone(this.cache.get(key)) as T;
  const path=join(this.directory,digest(key)+'.json');
  if(!existsSync(path))return null;
  const value=JSON.parse(readFileSync(path,'utf8'));this.remember(key,value);return structuredClone(value) as T;
 }
 write<T>(key:string,value:T){
  const path=join(this.directory,digest(key)+'.json');
  writeFileSync(path+'.tmp',JSON.stringify(value),{encoding:'utf8',mode:0o600});renameSync(path+'.tmp',path);
  this.remember(key,structuredClone(value));
 }
}
