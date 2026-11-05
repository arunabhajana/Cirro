import { useEffect,useState,useRef,type SetStateAction } from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {invoke} from './ipc';
export function usePreference<T>(account:string|undefined,key:string,fallback:T){
 const history=useRef(true);
 useEffect(()=>{if(key!=='recent')return;const changed=(event:Event)=>{history.current=(event as CustomEvent<boolean>).detail;if(!history.current)setState(old=>({...old,value:fallback}));};window.addEventListener('cirro-history',changed);void invoke<{policy:{recent:boolean}}>('security_command',{action:'status',value:null}).then(value=>{history.current=value.policy.recent;if(!history.current)setState(old=>({...old,value:fallback}));}).catch(()=>{});return()=>window.removeEventListener('cirro-history',changed);},[key]);
 const [state,setState]=useState<{account:string|undefined;value:T;ready:boolean}>({account,value:fallback,ready:false});
 useEffect(()=>{let active=true;setState({account,value:fallback,ready:false});if(!account||!isTauri())return;invoke<T|null>('drive_preference',{key}).then(value=>{if(active)setState({account,value:key==='recent'&&!history.current?fallback:value??fallback,ready:true});}).catch(()=>{});return()=>{active=false;};},[account,key]);
 const value=state.account===account?state.value:fallback;
 const setValue=(next:SetStateAction<T>)=>setState(old=>{if(key==='recent'&&!history.current)return old;const value=typeof next==='function'?(next as (value:T)=>T)(old.value):next;return {...old,value};});
 useEffect(()=>{if(account&&state.account===account&&state.ready)void invoke('drive_setting',{key,value:state.value}).catch(()=>{});},[account,key,state]);
 return [value,setValue] as const;
}
