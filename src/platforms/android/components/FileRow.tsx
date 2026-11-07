import {useEffect,useRef} from 'react';
import {Check,CloudOff,MoreHorizontal,FileText,Folder,FileImage,FileSpreadsheet} from 'lucide-react';
import type {DriveFile} from '../../../data';
export default function FileRow({file,account,selecting,checked,onToggle,onOpen,onActions}:{file:DriveFile;account?:string;selecting:boolean;checked:boolean;onToggle:()=>void;onOpen:()=>void;onActions:()=>void}){
 const gesture=useRef<{x:number;y:number;timer:ReturnType<typeof setTimeout>|null;held:boolean}|null>(null);
 useEffect(()=>()=>{if(gesture.current?.timer)clearTimeout(gesture.current.timer);},[]);
 const clear=()=>{if(gesture.current?.timer)clearTimeout(gesture.current.timer);if(gesture.current)gesture.current.timer=null;};
 const Icon=file.type==='folder'?Folder:file.type==='image'?FileImage:file.type==='sheet'?FileSpreadsheet:FileText;
 return <article className={'m-file '+(checked?'is-selected':'')} onContextMenu={event=>{event.preventDefault();if(!checked)onToggle();}}>
 {selecting&&<button role="checkbox" aria-checked={checked} aria-label={'Select '+file.name} className={'m-file-checkbox '+(checked?'checked':'')} onClick={onToggle}>{checked&&<Check size={16}/>}</button>}
 <button className="m-file-open" onPointerDown={event=>{if(event.button!==0)return;clear();gesture.current={x:event.clientX,y:event.clientY,held:false,timer:setTimeout(()=>{if(gesture.current){gesture.current.held=true;onToggle();}},450)};}} onPointerMove={event=>{if(gesture.current&&Math.hypot(event.clientX-gesture.current.x,event.clientY-gesture.current.y)>10)clear();}} onPointerUp={clear} onPointerCancel={()=>{clear();gesture.current=null;}} onPointerLeave={clear} onClick={()=>{if(gesture.current?.held){gesture.current=null;return;}if(selecting)onToggle();else onOpen();}}><span className={'m-glyph '+file.type}><Icon size={21}/></span><span><strong>{file.name}</strong><small>{file.size} · {account}{file.offline&&<CloudOff size={12}/>}</small></span></button>
 {!selecting&&<button className="m-file-more" aria-label={'Actions for '+file.name} onClick={onActions}><MoreHorizontal size={20}/></button>}</article>;
}
