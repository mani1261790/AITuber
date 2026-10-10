import { RichText } from "./rich-text.tsx";

/** Deliberately small board dialect: no raw HTML, links, images or arbitrary layout. */
export function BoardMarkdown({text,id}:{text:string;id:string}) {
  return <div className="board-markdown" data-semantic-id={id}>{text.split(/\r?\n/).filter(line=>line.trim()).map((line,i)=>{
    const heading=/^#{1,2}\s+/.test(line);
    const content=line.replace(/^#{1,2}\s+/,"").replace(/^[-*]\s+/,"・ ");
    const parts=content.split(/(\*\*[^*]+\*\*)/g).map((part,j)=>part.startsWith("**")?<strong key={j}><RichText text={part.slice(2,-2)}/></strong>:<RichText key={j} text={part}/>);
    return heading?<h3 key={i}>{parts}</h3>:<p key={i}>{parts}</p>;
  })}</div>;
}

/** Fit the whole note uniformly; never clip a formula or add board scrolling. */
export function fitBoardMarkdown(root:HTMLElement) {
  const content=root.querySelector<HTMLElement>(".board-markdown");
  if(!content)return;
  const scale=Math.min(1,1120/Math.max(1,content.scrollWidth),560/Math.max(1,content.scrollHeight));
  content.style.transform=`scale(${scale})`;
  content.style.transformOrigin="top left";
}
