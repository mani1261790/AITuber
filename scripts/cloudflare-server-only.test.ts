import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error deployment helper is executed as native JavaScript
import {serverOnlyConfig} from './cloudflare-server-only.mjs';
it('retains asset binding and worker-first auth routing without registering a new asset manifest',()=>{
 const original=JSON.parse(readFileSync(new URL('../apps/cloudflare/wrangler.jsonc',import.meta.url),'utf8'));
 const before=structuredClone(original),config=serverOnlyConfig(original);
 expect(original).toEqual(before);expect(config.assets).toBeUndefined();
 expect(config.unsafe.bindings).toContainEqual({name:'ASSETS',type:'assets'});
 expect(config.unsafe.metadata).toEqual({keep_assets:true,assets:{config:{run_worker_first:true}}});
 for(const key of ['durable_objects','r2_buckets','migrations','vars','main','alias'])expect(config[key]).toEqual(original[key]);
 expect(()=>serverOnlyConfig({...original,name:'other'})).toThrow();
 expect(()=>serverOnlyConfig({...original,assets:{...original.assets,run_worker_first:false}})).toThrow();
});
