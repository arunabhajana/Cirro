import {useEffect,useRef} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {navigation,isAvailable,type Page} from './workspace';
import type {DriveFile} from './data';
type Location={page:Page;scope:string;folder:string|null};
const home:Location={page:'Home',scope:'all',folder:null};
export function validLocation(saved:unknown,accounts:string[],files:DriveFile[]):Location{
 if(!saved||typeof saved!=='object')return home;const value=saved as Location;
 if(![...navigation.map(item=>item.name),'Settings'].includes(value.page)||typeof value.scope!=='string'||(value.scope!=='all'&&!accounts.includes(value.scope)))return home;
 if(value.folder){const file=files.find(file=>file.id===value.folder);if(!file||file.type!=='folder'||!isAvailable(file,files)||(value.scope!=='all'&&file.account!==value.scope))return {...home,scope:value.scope};}
 return {page:value.page,scope:value.scope,folder:value.folder||null};
}
export function useStartupLocation(user:string|undefined,accounts:string[],files:DriveFile[],location:Location,go:(location:Location)=>void){
 const latest=useRef({accounts,files,location,go});latest.current={accounts,files,location,go};const restored=useRef(false);const initial=useRef(false);
 useEffect(()=>{if(!user||!isTauri()||initial.current)return;initial.current=true;let active=true;let applied=false;let ready=files.length>0;let loaded=false;let saved:unknown=null;let enabled=false;
 const restore=()=>{if(!active||applied||!loaded||!ready)return;applied=true;if(latest.current.location.page==='Home'&&!latest.current.location.folder&&latest.current.location.scope==='all')latest.current.go(enabled?validLocation(saved,latest.current.accounts,latest.current.files):home);restored.current=true;};
 const workspace=()=>{ready=true;restore();};window.addEventListener('cirro-workspace-ready',workspace);
 void Promise.all([invoke<{restore:boolean}>('startup_settings',{value:null}),invoke('device_preference',{key:'startup:lastLocation',migrateKey:null,migrateAccount:null})]).then(([prefs,value])=>{enabled=prefs.restore;saved=value;loaded=true;restore();}).catch(()=>{loaded=true;ready=true;restore();});
 return()=>{active=false;window.removeEventListener('cirro-workspace-ready',workspace);if(!applied)initial.current=false;};
 },[user]);
 useEffect(()=>{if(!user||!restored.current||!isTauri())return;const timer=setTimeout(()=>{void invoke('device_setting',{key:'startup:lastLocation',value:location}).catch(()=>{});},300);return()=>clearTimeout(timer);},[user,location.page,location.scope,location.folder]);
}
