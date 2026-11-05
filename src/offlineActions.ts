import {invoke} from './ipc';
import {listen} from '@tauri-apps/api/event';
import type {DriveFile} from './data';
export async function offlineAction(file:DriveFile,progress:{update:(value:number,label?:string)=>void}){
 const unlisten=await listen<{account?:string;id:string;completed:number;total:number;name:string}>('cirro-offline-progress',event=>{const value=event.payload;if(value.id===file.id.split("::").pop()&&(!value.account||value.account===file.account)&&value.total>0)progress.update(value.completed/value.total*100,`Saving ${file.name}: ${value.name}`);});
 try{return await invoke<{files?:number;onlineLinks?:number}|null>(file.offline?'offline_remove':'offline_save',{id:file.id});}finally{unlisten();}
}
