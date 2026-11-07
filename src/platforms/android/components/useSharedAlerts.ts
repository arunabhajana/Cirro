import {useEffect,useRef,useState} from 'react';
import type {Snapshot} from '../drive/model';
export function useSharedAlerts(snapshots:Record<string,Snapshot>,publish:(title:string,message:string,options:{category:'shared';account:string})=>void){
 const [initial]=useState<Record<string,string[]>>(()=>{try{return JSON.parse(localStorage.getItem('cirro-seen-shares-v1')||'{}');}catch{return {};}});const known=useRef(initial);
 useEffect(()=>{for(const snapshot of Object.values(snapshots)){const shared=snapshot.files.filter(file=>file.sharedWithMeTime&&!file.trashed);const before=known.current[snapshot.account];if(before)for(const file of shared)if(!before.includes(file.id))publish('A file was shared with you',file.name,{category:'shared',account:snapshot.account});known.current[snapshot.account]=shared.map(file=>file.id);}try{localStorage.setItem('cirro-seen-shares-v1',JSON.stringify(known.current));}catch{}},[snapshots,publish]);
}
