import {useCallback,useEffect,useRef,useState} from 'react';
import {androidUpdates,updatesAvailable,type AndroidRelease,type AppBuild,type UpdateProgress} from './native';
import pkg from '../../../../package.json';
export type UpdateStage='idle'|'checking'|'available'|'downloading'|'verifying'|'ready'|'current'|'unpublished'|'error';
function saved(key:string){try{return localStorage.getItem(key)||'';}catch{return '';}}
function store(key:string,value:string){try{localStorage.setItem(key,value);}catch{}}
function newer(candidate:string,installed:string){if(!/^\d+\.\d+\.\d+$/.test(candidate))return false;const left=candidate.split('.').map(Number),right=installed.split('.').map(Number);for(let index=0;index<3;index++){if(left[index]!== (right[index]||0))return left[index]>(right[index]||0);}return false;}
export function useAndroidUpdates(){
 const [build,setBuild]=useState<AppBuild>({version:pkg.version,versionCode:0,wasUpdated:false}),[release,setRelease]=useState<AndroidRelease|null>(null),[stage,setStage]=useState<UpdateStage>('idle'),[message,setMessage]=useState(''),[progress,setProgress]=useState<UpdateProgress>({bytes:0,total:0,phase:'Preparing'}),[prompt,setPrompt]=useState(false),[whatsNew,setWhatsNew]=useState(false),[autoDownload,setAutoDownloadState]=useState(()=>saved('cirro-auto-download-updates')!=='false');
 const busy=useRef(false),alive=useRef(true),currentBuild=useRef(''),lastCheck=useRef(0),currentStage=useRef(stage),automatic=useRef(autoDownload);
 currentStage.current=stage;automatic.current=autoDownload;
 const downloadRelease=useCallback(async(candidate:AndroidRelease)=>{
  setMessage('');setStage('downloading');setProgress({bytes:0,total:candidate.size,phase:'Preparing'});
  try{await androidUpdates.download({release:candidate});if(alive.current){setStage('ready');if(saved('cirro-update-later')!==candidate.version)setPrompt(true);}}
  catch(error){if(alive.current){setStage((error as {code?:string}).code==='UPDATE_CANCELLED'?'available':'error');setMessage(error instanceof Error?error.message:'The update could not be downloaded.');}}
 },[]);
 const check=useCallback(async(manual=false)=>{
  if(!updatesAvailable()){setMessage('Install the updated Android APK to check for updates.');return;}
  if(!manual&&Date.now()-lastCheck.current<15*60*1000)return;
  if(busy.current||['downloading','verifying','ready'].includes(currentStage.current))return;
  busy.current=true;lastCheck.current=Date.now();setMessage('');setStage('checking');
  try{
   const result=await androidUpdates.check();if(!alive.current)return;
   if(result.available&&result.release){
    const candidate=result.release;setRelease(candidate);store('cirro-update-candidate',JSON.stringify(candidate));setStage('available');
    if(manual||saved('cirro-update-later')!==candidate.version)setPrompt(true);
    if(automatic.current&&saved('cirro-update-later')!==candidate.version&&saved('cirro-update-download-paused')!==candidate.version)await downloadRelease(candidate);
   }else{setRelease(null);store('cirro-update-candidate','');setStage(result.published?'current':'unpublished');}
  }catch(error){if(alive.current){setStage('error');setMessage(error instanceof Error?error.message:'Couldn’t check for updates.');}}
  finally{busy.current=false;}
 },[downloadRelease]);
 useEffect(()=>{
  alive.current=true;let active=true;let listener:{remove():Promise<void>}|undefined;
  if(updatesAvailable())void androidUpdates.info().then(info=>{
   if(!active||!alive.current)return;setBuild(info);currentBuild.current=info.version+':'+info.versionCode;
   const previous=saved('cirro-seen-native-build');
   if(previous&&previous!==currentBuild.current||!previous&&info.wasUpdated)setWhatsNew(true);else if(!previous)store('cirro-seen-native-build',currentBuild.current);
   if(info.ready){setRelease(info.ready);setStage('ready');if(info.openUpdates)setPrompt(true);}
   else{try{const candidate=JSON.parse(saved('cirro-update-candidate')||'null') as AndroidRelease|null;if(candidate&&typeof candidate.version==='string'&&newer(candidate.version,info.version)&&typeof candidate.size==='number'&&/^[a-f0-9]{64}$/.test(candidate.sha256)){setRelease(candidate);setStage('available');}}catch{}void check();}
  }).catch(()=>{if(active)setMessage('Couldn’t read this installation’s update information.');});
  if(updatesAvailable())void androidUpdates.addListener('progress',value=>{if(active){setProgress(value);setStage(value.phase==='Verifying'?'verifying':'downloading');}}).then(value=>{if(!active)void value.remove();else listener=value;}).catch(()=>{});
  const resume=()=>{if(document.visibilityState==='visible')void check();};
  document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);
  const timer=setInterval(resume,15*60*1000);
  return()=>{active=false;alive.current=false;void listener?.remove();clearInterval(timer);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);};
 },[check]);
 async function download(){if(!release||busy.current)return;busy.current=true;store('cirro-update-download-paused','');try{await downloadRelease(release);}finally{busy.current=false;}}
 async function install(){setMessage('');try{const result=await androidUpdates.install();if(result.needsPermission)setMessage('Allow “Install unknown apps” for Cirro in Android settings, then tap Install update again.');}catch(error){setMessage(error instanceof Error?error.message:'Couldn’t open the Android installer.');}}
 function later(){if(release)store('cirro-update-later',release.version);setPrompt(false);}
 function cancel(){if(release)store('cirro-update-download-paused',release.version);void androidUpdates.cancel().catch(()=>{});}
 function setAutoDownload(value:boolean){store('cirro-auto-download-updates',String(value));setAutoDownloadState(value);automatic.current=value;}
 function dismissWhatsNew(){store('cirro-seen-native-build',currentBuild.current||build.version+':'+build.versionCode);setWhatsNew(false);}
 return {build,release,stage,message,progress,prompt,whatsNew,autoDownload,setAutoDownload,check,download,install,later,dismissWhatsNew,consumePrompt:()=>setPrompt(false),cancel,native:updatesAvailable()};
}
