import {useState,useEffect} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {useDevicePreference,waitForDevicePreference} from './devicePreferences';
import {accounts} from './data';
import {driveState} from './drive';
const defaults={enabled:true,uploads:true,errors:true,storage:true,dnd:false,sound:false};
export async function notify(category:string,title:string,body:string){if(!isTauri())return 'development';await waitForDevicePreference('notifications');return invoke<string>('desktop_notification',{category,title,body});}
const recent=new Map<string,number>();
const pending=new Set<string>();
export function notifyQuietly(category:string,title:string,body:string){const key=JSON.stringify([category,title,body]);const now=Date.now();for(const [id,time] of recent)if(now-time>=300000)recent.delete(id);if(pending.has(key)||recent.has(key))return;pending.add(key);void notify(category,title,body).then(result=>{if(result==='sent')recent.set(key,Date.now());}).catch(()=>{}).finally(()=>pending.delete(key));}
export function NotificationEvents(){useEffect(()=>{
 if(!isTauri())return;
 const flow=listen<{name:string;error:string}>('cirro-flow-error',({payload})=>notifyQuietly('errors','Sync needs attention',`${payload.name}: ${payload.error}`));
 const cloud=listen<string>('cirro-cloud-error',({payload})=>notifyQuietly('errors','Download needs attention',payload));
 const storagePending=new Set<string>();
 const storage=()=>{for(const account of accounts){if(account.total>0&&account.used/account.total>=.9){const key=`cirro-storage-alert:${account.id}`;const last=Number(localStorage.getItem(key)||0);if(!storagePending.has(key)&&Date.now()-last>86400000){storagePending.add(key);void notify('storage','Drive storage is nearly full',`${account.name} · ${Math.round(account.used/account.total*100)}% used`).then(result=>{if(result==='sent')localStorage.setItem(key,String(Date.now()));}).catch(()=>{}).finally(()=>storagePending.delete(key));}}}};
 const errors=()=>{if(driveState.error)notifyQuietly('errors','Drive needs attention',driveState.error);};
 const accountErrors=(event:Event)=>notifyQuietly('errors','Account needs attention',String((event as CustomEvent).detail));
 window.addEventListener('cirro-account-error',accountErrors);
 window.addEventListener('cirro-drive-state',errors);
 window.addEventListener('cirro-workspace-ready',storage);
 return()=>{void flow.then(stop=>stop()).catch(()=>{});void cloud.then(stop=>stop()).catch(()=>{});window.removeEventListener('cirro-workspace-ready',storage);window.removeEventListener('cirro-drive-state',errors);window.removeEventListener('cirro-account-error',accountErrors);};
},[]);return null;}
export default function NotificationSettings(){
 const [stored,setStored]=useDevicePreference('notifications',defaults);const prefs={...defaults,...stored};const [message,setMessage]=useState('');const [testing,setTesting]=useState(false);
 async function sendTest(){if(testing)return;setTesting(true);setMessage('');try{const result=await notify('test','You’re all set','Cirro will let you know when a transfer needs attention.');setMessage(result==='development'?'Development mode: native desktop notifications are disabled.':result==='muted'?'Notifications are muted by your Cirro preferences.':'Test notification sent. Windows focus settings may silence its banner.');}catch(reason){setMessage(String(reason));}finally{setTesting(false);}}
 const rows=[['enabled','Desktop notifications','Show Windows notifications from Cirro.'],['uploads','Upload complete','Notify when an upload batch finishes.'],['errors','Transfer errors','Alert when uploads, downloads, or sync need attention.'],['storage','Storage warnings','Warn at 90% usage, at most once per account each day.'],['dnd','Do not disturb','Silence all Cirro desktop notifications until turned off.'],['sound','Notification sound','Play the Windows notification sound.']] as const;
 return <div className="settings-card">{rows.map(([key,title,description])=><div className="preference-row" key={key}><div><h3>{title}</h3><p>{description}</p></div><button className="toggle" role="switch" aria-label={title} aria-checked={prefs[key]} onClick={()=>setStored({...prefs,[key]:!prefs[key]})}><span/></button></div>)}<div className="preference-row"><div><h3>Test notification</h3><p>Send a notification to check your Windows notification settings.</p>{message&&<p role="status">{message}</p>}</div><button className="secondary-button" disabled={testing} onClick={()=>void sendTest()}>{testing?'Sending…':'Send test'}</button></div></div>;
}
