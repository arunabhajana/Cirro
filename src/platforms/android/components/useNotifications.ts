import {postNativeNotification,notificationStatus,requestNativeNotifications,nativeNotificationsAvailable} from './nativeNotifications';
import {useCallback,useEffect,useState} from 'react';
export type NotificationItem={id:string;title:string;message:string;time:number;read:boolean;account?:string;action?:'connect'|'sync'|'transfers';category:'errors'|'activity'|'sync'|'shared'|'transfers'};
export type NotificationPreferences={banners:boolean;errors:boolean;activity:boolean;sync:boolean;quiet:boolean;system:boolean;shared:boolean;transfers:boolean;sound:boolean};
const defaults:NotificationPreferences={banners:true,errors:true,activity:true,sync:true,quiet:false,system:false,shared:true,transfers:true,sound:true};
export function useNotifications(){
 const [items,setItems]=useState<NotificationItem[]>(()=>{try{return JSON.parse(localStorage.getItem('cirro-notifications-v1')||'[]').slice(0,60);}catch{return [];}});
 const [preferences,setPreferences]=useState<NotificationPreferences>(()=>{try{return {...defaults,...JSON.parse(localStorage.getItem('cirro-notification-preferences-v1')||'{}')};}catch{return defaults;}});
 const [banner,setBanner]=useState<NotificationItem|null>(null);
 useEffect(()=>{try{localStorage.setItem('cirro-notifications-v1',JSON.stringify(items));}catch{}},[items]);
 useEffect(()=>{try{localStorage.setItem('cirro-notification-preferences-v1',JSON.stringify(preferences));}catch{}},[preferences]);
 useEffect(()=>{if(!banner)return;const timer=setTimeout(()=>setBanner(null),2000);return()=>clearTimeout(timer);},[banner]);
 const publish=useCallback((title:string,message:string,options:Partial<Pick<NotificationItem,'account'|'action'|'category'>>&{native?:boolean}={})=>{
  const {native:sendNative=true,...metadata}=options;const category=options.category||'activity';if(!preferences[category])return;
  title=title.replace(/\s+/g,' ').trim().slice(0,200);message=message.replace(/\s+/g,' ').trim().slice(0,1000);
  const item:NotificationItem={id:crypto.randomUUID(),title,message,time:Date.now(),read:false,category,...metadata};setItems(old=>[item,...old].slice(0,60));if(preferences.banners&&!preferences.quiet)setBanner(item);if(sendNative&&preferences.system&&!preferences.quiet)void postNativeNotification({id:Math.floor(Date.now()%1000000000)+5000,title,message,silent:!preferences.sound,shared:category==='shared',kind:category}).catch(()=>{});
 },[preferences]);
 const markRead=useCallback(()=>{setItems(old=>old.map(item=>({...item,read:true})));setBanner(null);},[]);
 const ensureTransferNotifications=async()=>{
  if(!nativeNotificationsAvailable()||!preferences.transfers)return false;
  if(preferences.system)return (await notificationStatus()).granted;
  try{if(localStorage.getItem('cirro-transfer-notifications-asked'))return false;localStorage.setItem('cirro-transfer-notifications-asked','1');}catch{}
  const status=await requestNativeNotifications();
  if(status.granted)setPreferences(old=>({...old,system:true}));
  return status.granted;
 };
 return {items,banner,publish,preferences,setPreferences,ensureTransferNotifications,markRead,clear:()=>{setItems([]);setBanner(null);},dismiss:()=>setBanner(null)};
}
