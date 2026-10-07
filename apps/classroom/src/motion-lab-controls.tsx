import {useEffect,useId,useRef,useState,type ReactNode} from "react";

export function LabSelect({label,value,options,onChange}:{label:string;value:string;options:{value:string;label:string}[];onChange:(value:string)=>void}){
  const id=useId(),host=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const [open,setOpen]=useState(false),[active,setActive]=useState(0);
  const selected=options.findIndex(option=>option.value===value);
  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(!host.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener("pointerdown",close);
    return()=>document.removeEventListener("pointerdown",close);
  },[open]);
  useEffect(()=>{if(open)document.getElementById(`${id}-${active}`)?.scrollIntoView({block:"nearest"});},[open,active,id]);
  const choose=(index:number)=>{const option=options[index];if(option)onChange(option.value);setOpen(false);trigger.current?.focus();};
  return <div className="lab-select" ref={host} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
    <span className="lab-label" id={`${id}-label`}>{label}</span>
    <button ref={trigger} className="lab-select-trigger" role="combobox" aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-controls={`${id}-list`} aria-haspopup="listbox" aria-activedescendant={open?`${id}-${active}`:undefined}
      onClick={()=>{setActive(Math.max(0,selected));setOpen(!open);}}
      onKeyDown={event=>{
        if(event.key==="Escape"){event.preventDefault();setOpen(false);}
        else if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)){
          event.preventDefault();setOpen(true);
          setActive(event.key==="Home"?0:event.key==="End"?options.length-1:!open?Math.max(0,selected):Math.max(0,Math.min(options.length-1,active+(event.key==="ArrowDown"?1:-1))));
        }else if(open && ["Enter"," "].includes(event.key)){event.preventDefault();choose(active);}
      }}>
      <span id={`${id}-value`}>{options[selected]?.label ?? "選択してください"}</span><span aria-hidden="true" className="lab-chevron"/>
    </button>
    {open && <div className="lab-select-menu" id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`}>
      {options.map((option,index)=><div key={option.value} id={`${id}-${index}`} role="option" aria-selected={value===option.value} data-active={index===active} onPointerMove={()=>setActive(index)} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(index)}><span>{option.label}</span><span aria-hidden="true">{value===option.value?"✓":""}</span></div>)}
    </div>}
  </div>;
}
export function LabGroup({title,children}:{title:string;children:ReactNode}){
  return <section className="lab-group"><h2>{title}</h2>{children}</section>;
}
export function LabToggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(checked:boolean)=>void}){
  return <button className="lab-toggle" role="switch" aria-checked={checked} onClick={()=>onChange(!checked)}><span>{label}</span><span className="lab-toggle-track" aria-hidden="true"><span/></span></button>;
}
