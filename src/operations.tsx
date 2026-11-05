import {useEffect, useState} from 'react';
import ProgressBar from './ProgressBar';
type Operation = {id:number; label:string; progress:number|null};
let sequence=0;
const active=new Map<number,Operation>();
function emit(){window.dispatchEvent(new CustomEvent('cirro-operations',{detail:[...active.values()]}));}
export function beginOperation(label:string){const id=++sequence;active.set(id,{id,label,progress:null});emit();return {update(progress:number,label?:string){const item=active.get(id);if(item){active.set(id,{...item,progress:Math.max(0,Math.min(100,progress)),...(label?{label}:{})});emit();}},finish(){active.delete(id);emit();}};}
export default function Operations(){const [items,setItems]=useState<Operation[]>([...active.values()]);useEffect(()=>{const listener=(event:Event)=>setItems((event as CustomEvent<Operation[]>).detail);window.addEventListener('cirro-operations',listener);return()=>window.removeEventListener('cirro-operations',listener);},[]);return items.length ? <aside className="operation-panel" aria-label="Drive operations" aria-live="polite">{items.map(item=><div key={item.id}><div className="operation-label"><strong title={item.label}>{item.label}</strong><span>{item.progress===null?'Working…':`${Math.round(item.progress)}%`}</span></div><ProgressBar value={item.progress} label={item.label}/></div>)}</aside>:null;}
