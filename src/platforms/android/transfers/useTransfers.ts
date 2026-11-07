import {transferNotice} from '../components/notificationCopy';
import {useEffect,useRef,useState} from 'react';
import {DriveOperations,type TransferSpec,type TransferProgress} from './operations';
import {nativeTransferProgress} from '../components/nativeNotifications';
import {formatBytes,type MobileDriveFile} from '../drive/model';

export type TransferJob={id:string;spec:TransferSpec;title:string;state:'running'|'complete'|'failed'|'cancelled'|'interrupted';progress:TransferProgress;error?:string;created:number;nativeNotified?:boolean};
export function transferFraction(progress:TransferProgress,kind?:TransferSpec['kind']){
 const raw=progress.byteTotal?Math.min(1,(progress.bytes||0)/progress.byteTotal):0;
 if(kind==='offline'||kind==='upload')return raw;
 const phase=progress.detail;
 return phase.startsWith('Downloading')?raw*.45:phase.startsWith('Preparing')?raw*.1:phase.startsWith('Uploading')||phase.startsWith('Uploaded')?.45+raw*.55:0;
}
type OfflineDownload=(file:MobileDriveFile,signal:AbortSignal,onProgress?:(bytes:number,total:number)=>void)=>Promise<void>;
const verbs={copy:'Copying',move:'Moving',upload:'Uploading',trash:'Moving to Trash',restore:'Restoring',delete:'Permanently deleting',star:'Adding to Starred',unstar:'Removing from Starred',offline:'Downloading'};
export function useTransfers(accounts:string[],onRefresh:()=>Promise<unknown>,onComplete:(job:TransferJob)=>void,offline:OfflineDownload,systemNotifications:boolean,ensureNotifications?:()=>Promise<boolean>){
 const [jobs,setJobs]=useState<TransferJob[]>(()=>{try{return JSON.parse(localStorage.getItem('cirro-android-transfers-v1')||'[]').map((job:TransferJob)=>({...job,state:job.state==='running'?'interrupted':job.state}));}catch{return [];}});
 const active=useRef<AbortController|null>(null),current=useRef(''),latest=useRef({onRefresh,onComplete,offline,systemNotifications,ensureNotifications});
 latest.current={onRefresh,onComplete,offline,systemNotifications,ensureNotifications};
 useEffect(()=>{try{localStorage.setItem('cirro-android-transfers-v1',JSON.stringify(jobs));}catch{}},[jobs]);
 const ids=accounts.slice().sort().join(',');useEffect(()=>()=>{active.current?.abort();},[ids]);
 async function run(spec:TransferSpec,retry?:TransferJob){
  if(active.current)throw new Error('Wait for the current transfer or cancel it in Transfers.');
  const controller=new AbortController();active.current=controller;
  const id=retry?.id||crypto.randomUUID();current.current=id;
  const count=spec.uploads?.length||spec.files?.length||0;
  const single=spec.uploads?.[0]?.name||spec.files?.[0]?.name;
  let job:TransferJob={id,spec,title:verbs[spec.kind]+' '+(count===1?single:count+' items'),state:'running',progress:{done:0,total:count,detail:'Preparing…'},created:retry?.created||Date.now()};
  const put=()=>setJobs(old=>[job,...old.filter(item=>item.id!==id)].slice(0,50));put();
  let lastNative=0,nativeStarted=false,enabled=latest.current.systemNotifications,chain=Promise.resolve();
  const notify=(finished=false)=>{
   if(!enabled&&!nativeStarted)return;
   lastNative=Date.now();
   const snapshot=job;
   const progress=Math.min(finished?100:99,Math.floor((snapshot.progress.done+Math.min(.99,transferFraction(snapshot.progress,spec.kind)))/Math.max(1,snapshot.progress.total)*100));
   const bytes=snapshot.progress.byteTotal?' · '+formatBytes(snapshot.progress.bytes||0)+' / '+formatBytes(snapshot.progress.byteTotal):'';
   const message=finished?transferNotice(snapshot).message:snapshot.progress.detail+bytes+' · '+snapshot.progress.done+' of '+snapshot.progress.total+' items';
   chain=chain.then(async()=>{
    await nativeTransferProgress({id:4001,title:finished?transferNotice(snapshot).title:snapshot.title,message,progress,total:100,done:finished,failed:snapshot.state==='failed'});
    nativeStarted=true;
    if(finished)job={...job,nativeNotified:true};
   }).catch(()=>{});
  };
  try{
   if(latest.current.ensureNotifications)enabled=await latest.current.ensureNotifications!().catch(()=>false);
   controller.signal.throwIfAborted();notify();
   await new DriveOperations().execute(id,spec,controller.signal,value=>{job={...job,progress:value};put();if(Date.now()-lastNative>400)notify();},latest.current.offline);
   controller.signal.throwIfAborted();job={...job,state:'complete',progress:{...job.progress,done:job.progress.total,detail:'Complete'}};
  }catch(error){job={...job,state:controller.signal.aborted?'cancelled':'failed',error:error instanceof Error?error.message:String(error)};}
  finally{
   notify(true);await chain;put();active.current=null;current.current='';
   latest.current.onComplete(job);
   await latest.current.onRefresh().catch(()=>{});
  }
  return job;
 }
 return {jobs:jobs.filter(job=>{const ids=[...job.spec.files?.map(file=>file.account)||[],...(job.spec.target?[job.spec.target.account]:[])];return ids.every(id=>accounts.includes(id));}),busy:jobs.some(job=>job.id===current.current&&job.state==='running'),run,cancel:()=>active.current?.abort(),clear:()=>setJobs(old=>old.filter(job=>job.state==='running'))};
}
