import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {FixedResponseLlmProvider,TestToneSpeechProvider} from '@aituber/providers';
import {PreparedArtifacts,digest} from './prepared-artifacts.ts';
import {PreparedReadings,ReadingSpeechProvider,alignOriginal,readingSpans} from './prepared-readings.ts';
const directories:string[]=[];function store(){const dir=mkdtempSync(join(tmpdir(),'lecture-readings-'));directories.push(dir);return {dir,store:new PreparedArtifacts(dir)};}
afterEach(()=>directories.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true})));
const source='Large Language ModelはLLMです。';const parts=[{text:'Large Language Model',reading:'ラージ ランゲージ モデル'},{text:'は',reading:'は'},{text:'LLM',reading:'エルエルエム'},{text:'です。',reading:'です。'}];const generated=[{id:'p0',reading:parts[0]!.reading},{id:'p2',reading:parts[2]!.reading}];
it('prepares and reviews the complete batch once and restores it without model calls',async()=>{
 const cache=store();const provider=new FixedResponseLlmProvider([{items:[{id:digest(source),parts:generated},{id:digest('2GBです。'),parts:[{id:'p1',reading:'ギガバイト'}]}]},{corrections:[]}]);
 const readings=new PreparedReadings(()=>provider,cache.store);await readings.prepare([source,'2GBです。',source],[],new AbortController().signal);
 expect(provider.calls).toHaveLength(2);expect(provider.calls[0]?.prompt).toContain('2GB');
 const restored=new PreparedReadings(()=>{throw Error('must not regenerate');},new PreparedArtifacts(cache.dir));
 expect(await restored.get(source,[],new AbortController().signal)).toEqual({text:source,parts});
});
it('rejects unknown span ids instead of accepting model-provided source text',async()=>{
 const cache=store();const bad={items:[{id:digest(source),parts:[{id:'unknown',reading:'ベツノブンデス。'}]}]};
 const provider=new FixedResponseLlmProvider([bad,bad]);
 await expect(new PreparedReadings(()=>provider,cache.store).get(source,[],new AbortController().signal)).rejects.toThrow('区間ID');
 expect(provider.calls).toHaveLength(2);
});
it('does not persist a reading rejected by the independent reviewer',async()=>{
 const cache=store();const value={items:[{id:digest(source),parts:generated}]};const provider=new FixedResponseLlmProvider([value,{corrections:[{utteranceId:'unknown',partId:'p0',expectedReading:'テスト',reading:'テスト',reason:'wrong pronunciation'}]},value,{corrections:[{utteranceId:'unknown',partId:'p0',expectedReading:'テスト',reading:'テスト',reason:'wrong pronunciation'}]}]);
 await expect(new PreparedReadings(()=>provider,cache.store).get(source,[],new AbortController().signal)).rejects.toThrow('修正対象');
 const next=new PreparedReadings(()=>null,new PreparedArtifacts(cache.dir));await expect(next.get(source,[],new AbortController().signal)).rejects.toThrow('未接続');
});
it('maps homophones by their source positions instead of inverse replacement',()=>{
 const reading={text:'橋と箸',parts:[{text:'橋と',reading:'ハシト'},{text:'箸',reading:'ハシ'}]};
 expect(alignOriginal(reading,[{text:'ハシト',startMs:0,endMs:300},{text:'ハシ',startMs:320,endMs:500}])).toEqual([{text:'橋と',startMs:0,endMs:300},{text:'箸',startMs:320,endMs:500}]);
 expect(()=>alignOriginal(reading,[{text:'ちがう',startMs:0,endMs:500}])).toThrow('区間時刻');
});
it('merges cues only when the real audio alignment straddles their boundary',()=>{
 expect(alignOriginal({text:'AとB',parts:[{text:'Aと',reading:'エート'},{text:'B',reading:'ビー'}]},[{text:'エートビー',startMs:10,endMs:600}])).toEqual([{text:'AとB',startMs:10,endMs:600}]);
});
it('sends the prepared pronunciation to TTS and returns original captions with a mapping-specific audio id',async()=>{
 const cache=store();const llm=new FixedResponseLlmProvider([{items:[{id:digest(source),parts:generated}]},{corrections:[]}]);
 const backing=new TestToneSpeechProvider(1000);const spy=vi.spyOn(backing,'synthesize');
 const provider=new ReadingSpeechProvider(backing,new PreparedReadings(()=>llm,cache.store),()=>[]);
 const result=await provider.synthesize({text:source,voiceId:'test',language:'ja-JP',dictionaryVersion:'test'},{signal:new AbortController().signal});
 expect(spy.mock.calls[0]![0].text).toBe(parts.map(part=>part.reading).join(''));expect(result.transcriptFormat).toBe('original');expect(result.segments.map(segment=>segment.text).join('')).toBe(source);
});

it('owns exact original spans including code, whitespace, astral characters and punctuation',()=>{
 for(const text of ['  Large Language ModelはLLMです。\n次です。','日本語と😀の長い説明。'.repeat(30),String.raw`C:\Users\mani\file.txt`, 'A'.repeat(100)]){
 const spans=readingSpans(text);expect(spans.map(part=>part.text).join('')).toBe(text);expect(spans.every(part=>part.text.length<=40)).toBe(true);expect(new Set(spans.map(part=>part.id)).size).toBe(spans.length);
 }
});

it('identifies the invalid reading span in repair feedback while preserving the source',async()=>{
 const cache=store();const provider=new FixedResponseLlmProvider([{items:[{id:digest(source),parts:[{id:'p0',reading:'LLMです。'},generated[1]!]}]},{items:[{id:digest(source),parts:[generated[0]!]}]},{corrections:[]}]);
 const result=await new PreparedReadings(()=>provider,cache.store).get(source,[],new AbortController().signal);
 const feedback=JSON.parse(provider.calls[1]!.prompt).failure;
 expect(feedback).toContain('p0');expect(feedback).toContain('LLMデス。');expect(result.text).toBe(source);expect(result.parts).toEqual(parts);
});

it('resumes a failed reading review with its prior mappings and exact correction feedback',async()=>{
 const cache=store();const value={items:[{id:digest(source),parts:generated}]};const provider=new FixedResponseLlmProvider([value,{corrections:[{utteranceId:'unknown',partId:'p0',expectedReading:'テスト',reading:'テスト',reason:'correct counter'}]},value,{corrections:[{utteranceId:'unknown',partId:'p0',expectedReading:'テスト',reading:'テスト',reason:'correct counter'}]},value,{corrections:[]}]);
 await expect(new PreparedReadings(()=>provider,cache.store).get(source,[],new AbortController().signal)).rejects.toThrow('修正対象');
 await new PreparedReadings(()=>provider,new PreparedArtifacts(cache.dir)).get(source,[],new AbortController().signal);
 expect(JSON.parse(provider.calls[4]!.prompt)).toMatchObject({candidate:value.items,failure:'読み審査の修正対象が一致しません'});
});

it('leaves Japanese-only utterances unchanged without an LLM',async()=>{
 const cache=store(),provider=vi.fn(()=>{throw Error('must not call');});const readings=new PreparedReadings(provider,cache.store);
 const text='漢字の説明は自然に読みます。数字は123です。';expect((await readings.get(text,[],new AbortController().signal)).parts.map(p=>p.reading).join('')).toBe(text);expect(provider).not.toHaveBeenCalled();
});
it('applies a concrete Latin reading correction without regenerating Japanese',async()=>{
 const cache=store(),text='Ollamaを使う。';const provider=new FixedResponseLlmProvider([{items:[{id:digest(text),parts:[{id:'p0',reading:'オラーマ'}]}]},{corrections:[{utteranceId:digest(text),partId:'p0',expectedReading:'オラーマ',reading:'オラマ',reason:'長音を削除'}]},{corrections:[]}]);const result=await new PreparedReadings(()=>provider,cache.store).get(text,[],new AbortController().signal);expect(result.parts.map(p=>p.reading).join('')).toBe('オラマを使う。');expect(provider.calls.map(c=>c.purpose)).toEqual(['generation','review','review']);
});
it('ignores legacy whole-kana packages and caches when synthesizing',async()=>{
 const cache=store(),legacy={text:source,parts:[{text:source,reading:'ラージランゲージモデルハエルエルエムデス。'}]};cache.store.write('reading-v1:'+digest([source,[]]),legacy);
 const llm=new FixedResponseLlmProvider([{items:[{id:digest(source),parts:generated}]},{corrections:[]}]);const readings=new PreparedReadings(()=>llm,cache.store);readings.install([legacy],[]);
 const backing=new TestToneSpeechProvider(1000),spy=vi.spyOn(backing,'synthesize');const provider=new ReadingSpeechProvider(backing,readings,()=>[],()=>[legacy]);await provider.synthesize({text:source,voiceId:'test',language:'ja-JP',dictionaryVersion:'test'},{signal:new AbortController().signal});expect(spy.mock.calls[0]![0].text).toBe('ラージ ランゲージ モデルはエルエルエムです。');
 const prompt=JSON.parse(llm.calls[0]!.prompt);expect(prompt.items[0].parts.map((p:{text:string})=>p.text)).toEqual(['Large Language Model','LLM']);
});
it('treats identical before and after readings as no correction',async()=>{
 const cache=store();const provider=new FixedResponseLlmProvider([{items:[{id:digest(source),parts:generated}]},{corrections:[{utteranceId:digest(source),partId:'p0',expectedReading:parts[0]!.reading,reading:parts[0]!.reading,reason:'問題ありません'}]}]);expect((await new PreparedReadings(()=>provider,cache.store).get(source,[],new AbortController().signal)).parts).toEqual(parts);expect(provider.calls).toHaveLength(2);
});

it('keeps leading whitespace and punctuation in original captions',()=>{expect(alignOriginal({text:' LLM。',parts:[{text:' ',reading:' '},{text:'LLM',reading:'エルエルエム'},{text:'。',reading:'。'}]},[{text:'エルエルエム。',startMs:0,endMs:200}])).toEqual([{text:' LLM。',startMs:0,endMs:200}]);});
