import { RichText } from "./rich-text.tsx";

/** Semantic layout only: no arbitrary CSS, raw HTML, links or images. */
export function BoardMarkdown({text,id}:{text:string;id:string}) {
  let separated=false;
  return <div className="board-markdown" data-semantic-id={id}>{text.split(/\r?\n/).map((line,i)=>{
    if(!line.trim()){separated=true;return null;}
    const clean=line.trim(),heading=/^#{1,2}\s+/.test(clean);
    const formula=/^\$\$[\s\S]+\$\$$/.test(clean);
    const indent=heading?0:Math.min(2,Math.floor((line.match(/^ */)?.[0].length??0)/2)) || (formula || /^[→⇒]/.test(clean)?1:0);
    const content=clean.replace(/^#{1,2}\s+/,"").replace(/^[-*]\s+/,"・ ");
    const className=`board-row${formula?" board-row--formula":""}${separated?" board-row--separated":""}`;
    separated=false;
    const parts=content.split(/(\*\*[^*]+\*\*)/g).map((part,j)=>part.startsWith("**")?<strong key={j}><RichText text={part.slice(2,-2)}/></strong>:<RichText key={j} text={part}/>);
    return heading?<h3 className={className} key={i}>{parts}</h3>:<p className={className} data-indent={indent} key={i}>{parts}</p>;
  })}</div>;
}

/** Keep a stable writing origin; short notes must not float into the board center. */
export function boardLayout(width:number,height:number){
  const scale=Math.min(1,1056/Math.max(1,width),560/Math.max(1,height));
  return {scale,left:112,top:80};
}
export function fitBoardMarkdown(root:HTMLElement) {
  const content=root.querySelector<HTMLElement>(".board-markdown");
  if(!content)return;
  const {scale,left,top}=boardLayout(content.scrollWidth,content.scrollHeight);
  Object.assign(content.style,{left:`${left}px`,top:`${top}px`,transform:`scale(${scale})`,transformOrigin:"top left"});
}
