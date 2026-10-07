import { Buffer } from 'node:buffer';
import { posix } from 'node:path';
import { runtime } from './context';
const chunkSize = 128 * 1024;
function sql() { return runtime().storage.sql; }
export function initializeFiles() {
  sql().exec('CREATE TABLE IF NOT EXISTS runtime_files(path TEXT PRIMARY KEY, modified INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS runtime_file_chunks(path TEXT NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(path,part))');
}
function pathOf(value: string) { const path = posix.normalize(value); if (!path.startsWith('/data/')) throw new TypeError('Invalid runtime file path'); return path; }
export function existsSync(value: string) { return sql().exec('SELECT path FROM runtime_files WHERE path=?', pathOf(value)).toArray().length > 0; }
export function mkdirSync(_path: string, _options?: unknown) { void _path; void _options; /* Directories are virtual; file paths are indexed. */ }
export function chmodSync(_path: string, _mode: number) { void _path; void _mode; /* Files are private to the DO or private R2 binding. */ }
export function writeFileSync(value: string, content: string | Uint8Array, options?: {flag?: string}) {
  const path = pathOf(value); const bytes = Buffer.from(content);
  runtime().storage.transactionSync(() => {
    if (options?.flag === 'wx' && existsSync(path)) throw Object.assign(new Error('File exists'), {code:'EEXIST'});
    sql().exec('INSERT INTO runtime_files VALUES(?,?) ON CONFLICT(path) DO UPDATE SET modified=excluded.modified', path, Date.now());
    sql().exec('DELETE FROM runtime_file_chunks WHERE path=?', path);
    for (let offset=0,part=0; offset<bytes.length; offset+=chunkSize,part++) sql().exec('INSERT INTO runtime_file_chunks VALUES(?,?,?)',path,part,bytes.subarray(offset,offset+chunkSize));
  });
}
export function readFileSync(value: string, encoding: 'utf8'): string;
export function readFileSync(value: string): Buffer;
export function readFileSync(value: string, encoding?: 'utf8'): Buffer | string {
  const path = pathOf(value); if (!existsSync(path)) throw Object.assign(new Error('File not found'),{code:'ENOENT'});
  const rows = sql().exec<{data:ArrayBuffer}>('SELECT data FROM runtime_file_chunks WHERE path=? ORDER BY part',path).toArray();
  const data = Buffer.concat(rows.map(row=>Buffer.from(row.data))); return encoding ? data.toString(encoding) : data;
}
export function renameSync(from: string, to: string) {
  runtime().storage.transactionSync(()=> {
    writeFileSync(to,readFileSync(from));
    sql().exec('DELETE FROM runtime_files WHERE path=?',pathOf(from)); sql().exec('DELETE FROM runtime_file_chunks WHERE path=?',pathOf(from));
  });
}
export function readdirSync(directory: string) {
  const prefix = `${posix.normalize(directory)}/`;
  return sql().exec<{path:string}>('SELECT path FROM runtime_files WHERE substr(path,1,?)=? ORDER BY path',prefix.length,prefix).toArray().map(row=>row.path.slice(prefix.length)).filter(name=>!name.includes('/'));
}
/** Move source binaries to R2 before acknowledging an upload; retain only metadata. */
const sourceFlushes = new WeakMap<DurableObjectStorage, Promise<void>>();
export async function flushSourceFiles() {
  const context=runtime();
  const previous=sourceFlushes.get(context.storage) ?? Promise.resolve();
  const pending=previous.catch(()=>undefined).then(async()=>{
    const files=sql().exec<{path:string}>('SELECT DISTINCT path FROM runtime_file_chunks WHERE path LIKE ?', '/data/authoring/sources/%').toArray();
    for(const {path} of files){
      await context.bucket.put(`sources/${posix.basename(path)}`,readFileSync(path));
      sql().exec('DELETE FROM runtime_file_chunks WHERE path=?',path);
    }
  });
  sourceFlushes.set(context.storage,pending);
  try { await pending; } finally { if(sourceFlushes.get(context.storage)===pending)sourceFlushes.delete(context.storage); }
}

export function unlinkSync(value: string) { const path=pathOf(value); runtime().storage.transactionSync(()=>{ sql().exec("DELETE FROM runtime_file_chunks WHERE path=?",path); sql().exec("DELETE FROM runtime_files WHERE path=?",path); }); }
