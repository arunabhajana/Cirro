import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
export default function SettingsDisclosure({title,children,className='',defaultOpen=false}:{title:ReactNode;children:ReactNode;className?:string;defaultOpen?:boolean}){
 const [open,setOpen]=useState(defaultOpen);const id=useId();const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const node=ref.current;const reveal=()=>setOpen(true);node?.addEventListener('cirro-reveal-setting',reveal);return()=>node?.removeEventListener('cirro-reveal-setting',reveal);},[]);
 return <div ref={ref} className={`settings-disclosure ${open?'is-open':''} ${className}`}><button type="button" className="settings-disclosure-trigger" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><span data-disclosure-label>{title}</span><i className="settings-disclosure-chevron" aria-hidden="true"/></button><div id={id} className="settings-disclosure-content" hidden={!open}>{children}</div></div>;
}
