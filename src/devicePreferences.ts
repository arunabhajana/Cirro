import {invoke,isTauri} from '@tauri-apps/api/core';
import {useEffect,useRef,useState,type SetStateAction} from 'react';
export function upgradeDevicePreference<T>(key:string,value:T):T {if(key==='device:sidebar'&&value&&typeof value==='object'&&!('transfersConfigured' in value)){const sidebar=value as {hidden?:string[]};return {...value,hidden:[...new Set([...(sidebar.hidden||[]),'Transfers'])],transfersConfigured:true} as T;}return value;}
const cache=new Map<string,unknown>();
const writes=new Map<string,Promise<unknown>>();
export async function waitForDevicePreference(key:string){await writes.get(key);}
function persist(key:string,value:unknown){const pending=(writes.get(key)||Promise.resolve()).catch(()=>{}).then(()=>invoke('device_setting',{key,value}));writes.set(key,pending);void pending.catch(error=>window.dispatchEvent(new CustomEvent('cirro-account-error',{detail:`Could not save device preferences: ${String(error)}`})));}
export function useDevicePreference<T>(key:string,fallback:T,migrateKey?:string,migrateAccount?:string){
 const fallbackRef=useRef(fallback);fallbackRef.current=fallback;
 const [state,setState]=useState<{key:string;value:T}>({key,value:cache.has(key)?cache.get(key) as T:fallback});
 const edits=useRef(0);const current=useRef(key);current.current=key;
 useEffect(()=>{let active=true;const revision=edits.current;setState({key,value:cache.has(key)?cache.get(key) as T:fallbackRef.current});if(isTauri())void invoke<T|null>('device_preference',{key,migrateKey:migrateKey||null,migrateAccount:migrateAccount||null}).then(value=>{if(active&&edits.current===revision){const saved=upgradeDevicePreference(key,value??fallbackRef.current);if(value&&JSON.stringify(saved)!==JSON.stringify(value))persist(key,saved);cache.set(key,saved);setState({key,value:saved});}}).catch(error=>window.dispatchEvent(new CustomEvent('cirro-account-error',{detail:`Could not load device preferences: ${String(error)}`})));return()=>{active=false;};},[key,migrateKey,migrateAccount]);
 const setValue=(next:SetStateAction<T>)=>{edits.current++;setState(old=>{if(current.current!==key)return old;const previous=old.key===key?old.value:fallbackRef.current;const value=typeof next==='function'?(next as (old:T)=>T)(previous):next;cache.set(key,value);if(isTauri())persist(key,value);return {key,value};});};
 return [state.key===key?state.value:cache.has(key)?cache.get(key) as T:fallback,setValue] as const;
}
