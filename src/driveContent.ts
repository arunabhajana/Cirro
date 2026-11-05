import {isTauri} from '@tauri-apps/api/core';
import {beginOperation} from './operations';
import {invoke} from './ipc';
type Content={data:string;mime:string;offline?:boolean;stale?:boolean};
import type {DriveFile} from './data';
const pendingThumbnails=new Map<string,Promise<Content>>();
export async function remoteContent(file:DriveFile,thumbnail=false){
  const operation=thumbnail?null:beginOperation(`Fetching ${file.name}`);
  try{
    const key=`${file.account}:${file.id}:${file.modified}`;
    let request=thumbnail?pendingThumbnails.get(key):undefined;
    if(!request){request=!thumbnail&&file.offline&&!navigator.onLine?invoke<Content|null>('offline_content',{id:file.id}).then(saved=>saved||invoke<Content>('drive_content',{id:file.id,thumbnail})):invoke<Content>('drive_content',{id:file.id,thumbnail});if(thumbnail){pendingThumbnails.set(key,request);const clear=()=>{if(pendingThumbnails.get(key)===request)pendingThumbnails.delete(key);};void request.then(clear,clear);}}
    let result;try{result=await request;}catch(error){const saved=thumbnail?null:await invoke<Content|null>('offline_content',{id:file.id}).catch(()=>null);if(!saved)throw error;result=saved;}
    const bytes=Uint8Array.from(atob(result.data),c=>c.charCodeAt(0));
    return {url:URL.createObjectURL(new Blob([bytes],{type:result.mime})),mime:result.mime,offline:result.offline,stale:result.stale};
  }finally{operation?.finish();}
}
export async function downloadFile(file:DriveFile){if(file.remote&&isTauri()){const operation=beginOperation(`Downloading ${file.name}`);try{await invoke('transfer_command',{action:'download',args:{account:file.account,source:file.id.includes('::')?file.id.split('::')[1]:file.id,name:file.name}});window.dispatchEvent(new Event('cirro-open-transfers'));return;}finally{operation.finish();}}const content=file.url?{url:file.url,mime:file.mimeType}:await remoteContent(file);const link=document.createElement('a');link.href=content.url;link.download=file.name+(content.mime==='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')?'.pdf':'');link.click();if(!file.url)setTimeout(()=>URL.revokeObjectURL(content.url),60000);}
