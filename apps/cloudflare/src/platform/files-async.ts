import { Buffer } from 'node:buffer';
import { runtime } from './context';
function key(path: string) { if (!path.startsWith('/data/')) throw new TypeError('Invalid file path'); return path.slice(6); }
export async function mkdir(_path: string, _options?: unknown) { void _path; void _options; }
export async function writeFile(path: string, data: string | Uint8Array) { await runtime().bucket.put(key(path),data); }
export async function readFile(path: string, encoding: 'utf8'): Promise<string>;
export async function readFile(path: string): Promise<Buffer>;
export async function readFile(path: string, encoding?: 'utf8'): Promise<Buffer | string> { const file=await runtime().bucket.get(key(path)); if (!file) throw Object.assign(new Error('File not found'),{code:'ENOENT'}); const data=Buffer.from(await file.arrayBuffer()); return encoding?data.toString(encoding):data; }
export async function unlink(path:string) { await runtime().bucket.delete(key(path)); }
export async function readdir(path: string) { const prefix=`${key(path)}/`; const names:string[]=[]; let cursor:string|undefined; do { const result=await runtime().bucket.list({prefix,...(cursor?{cursor}:{})}); names.push(...result.objects.map(o=>o.key.slice(prefix.length)).filter(n=>!n.includes('/'))); cursor=result.truncated?result.cursor:undefined; } while(cursor); return names; }
export async function stat(path: string) { const file=await runtime().bucket.head(key(path)); if(!file)throw Object.assign(new Error('File not found'),{code:'ENOENT'}); return {isFile:()=>true,mtimeMs:file.uploaded.getTime()}; }
