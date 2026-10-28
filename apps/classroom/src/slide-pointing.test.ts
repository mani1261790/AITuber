import {expect,it} from 'vitest';
import {inferredPdfRegion,spokenSlideTarget,pdfTextRegions} from './slide-pointing.ts';
it('points only to a visible, located term mentioned in the current utterance',()=>{
 const targets=[{id:'a',label:'Ollama',visible:true},{id:'b',label:'Python',visible:true}];
 expect(spokenSlideTarget('Ollamaでモデルを動かします',targets,[{id:'a'}])).toBe('a');
 expect(spokenSlideTarget('Pythonで接続します',targets,[{id:'a'}])).toBeNull();
 expect(spokenSlideTarget('次に進みます',targets,[{id:'a'}])).toBeNull();
});
it('uses a unique actual PDF text box and rejects ambiguity and missing text',()=>{
 const box={text:'Ollama',x:20,y:30,width:80,height:20};
 expect(inferredPdfRegion('Ollama',[box],200,100)).toEqual({x:.1,y:.3,width:.4,height:.2});
 expect(inferredPdfRegion('Ollama',[box,box],200,100)).toBeNull();
 expect(inferredPdfRegion('Python',[box],200,100)).toBeNull();
});
it('locates source terms when the authored label adds a descriptive suffix',()=>{
 expect(inferredPdfRegion('量子化の考え方',[{text:'量子化',x:20,y:30,width:80,height:20}],200,100)).not.toBeNull();
 expect(spokenSlideTarget('Pythonから呼び出します',[{id:'python',label:'Pythonクライアント',visible:true}],[{id:'python'}])).toBe('python');
});
it('locates speech on PDF text even when descriptive semantic labels do not occur on the slide',()=>{
 const regions=[{id:'pdf-text:0',text:'ollama pull llama3.2'},{id:'pdf-text:1',text:'ollama run llama3.2'},{id:'pdf-text:2',text:'注意点'}];
 expect(spokenSlideTarget('ollama pullでモデルを取得します',[{id:'cli',label:'モデル取得と実行',visible:true}],regions)).toBe('pdf-text:0');
 expect(spokenSlideTarget('ollama runで実行します',[],regions)).toBe('pdf-text:1');
 expect(spokenSlideTarget('これを確認します',[],regions)).toBeNull();
 expect(spokenSlideTarget('トークンは文字のかたまりです',[],[{id:'tokens',text:'トークンに分割'}])).toBe('tokens');
});

it('joins split command runs without joining separate columns or pointing outside the page',()=>{
 const regions=pdfTextRegions([{text:'ollama',x:10,y:10,width:40,height:10},{text:'pull',x:55,y:10,width:30,height:10},{text:'ollama',x:10,y:40,width:40,height:10},{text:'run',x:55,y:40,width:30,height:10},{text:'別の列',x:170,y:10,width:30,height:10},{text:'outside',x:190,y:50,width:30,height:10}],200,100);
 expect(regions.map(r=>r.text)).toEqual(['ollama pull','別の列','ollama run']);
 expect(regions.find(r=>r.id===spokenSlideTarget('ollama runで実行します',[],regions))?.text).toBe('ollama run');
});
