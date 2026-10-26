import {expect,it} from 'vitest';
import {inferredPdfRegion,spokenSlideTarget} from './slide-pointing.ts';
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
