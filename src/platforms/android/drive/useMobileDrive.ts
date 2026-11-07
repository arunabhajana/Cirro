import { useEffect, useMemo, useRef, useState } from 'react';
import type { MobileUser } from '../auth/googleIdentity';
import { DriveConsentRequired, driveAccessToken } from '../auth/nativeGoogle';
import { mobileDriveClient } from './client';
import { clearSnapshots, readSnapshot, saveSnapshot } from './cache';
import { mapSnapshot, type MobileDriveFile, type Snapshot } from './model';

export type SyncState = { syncing:boolean; needsAccess:boolean; error:string; lastSync?:string };
export function useMobileDrive(users:MobileUser[],enabled:boolean) {
  const [snapshots,setSnapshots]=useState<Record<string,Snapshot>>({});
  const [states,setStates]=useState<Record<string,SyncState>>({});
  const latest=useRef(snapshots);const generation=useRef(0);const controllers=useRef(new Map<string,AbortController>());
  const authorizing=useRef(false);const userIds=users.map(user=>user.id).sort().join(',');
  const blocked=useRef(new Set<string>());
  function state(account:string,patch:Partial<SyncState>){setStates(old=>({...old,[account]:{...(old[account] || {syncing:false,needsAccess:false,error:''}),...patch}}));}
  function apply(snapshot:Snapshot){latest.current={...latest.current,[snapshot.account]:snapshot};setSnapshots(latest.current);}
  async function sync(account:string,interactive=false) {
    if(!enabled || controllers.current.has(account) || authorizing.current || !interactive && blocked.current.has(account))return;
    const epoch=generation.current;const controller=new AbortController();controllers.current.set(account,controller);
    state(account,{syncing:true,error:''});
    try {
      if(interactive){authorizing.current=true;await driveAccessToken(account,true);authorizing.current=false;blocked.current.delete(account);}
      if(epoch!==generation.current)return;
      const snapshot=await mobileDriveClient.sync(account,latest.current[account],controller.signal);
      if(epoch!==generation.current)return;
      apply(snapshot);state(account,{syncing:false,needsAccess:false,error:'',lastSync:snapshot.syncedAt});
      // A cache failure must not discard a successful online sync.
      await saveSnapshot(snapshot).catch(()=>{});return true;
    } catch(error) {
      if(epoch===generation.current && !controller.signal.aborted){if(error instanceof DriveConsentRequired)blocked.current.add(account);state(account,{syncing:false,needsAccess:error instanceof DriveConsentRequired,error:error instanceof Error?error.message:'Drive sync failed. Try again.'});}return false;
    } finally {
      if(interactive)authorizing.current=false;
      if(controllers.current.get(account)===controller)controllers.current.delete(account);
      if(epoch===generation.current)state(account,{syncing:false});
    }
  }
  useEffect(()=>{
    const epoch=++generation.current;
    if(!enabled){latest.current={};setSnapshots({});setStates({});return;}
    const allowed=new Set(users.map(user=>user.id));
    setStates(old=>Object.fromEntries(Object.entries(old).filter(([id])=>allowed.has(id))));
    blocked.current=new Set([...blocked.current].filter(id=>allowed.has(id)));
    latest.current=Object.fromEntries(Object.entries(latest.current).filter(([id])=>allowed.has(id)));setSnapshots(latest.current);
    for(const user of users)void readSnapshot(user.id).catch(()=>undefined).then(cached=>{
      if(epoch!==generation.current)return;
      if(cached && !latest.current[user.id]){apply(cached);state(user.id,{lastSync:cached.syncedAt});}
      void sync(user.id);
    });
    const refresh=()=>{if(document.visibilityState==='visible' && navigator.onLine)for(const user of users)void sync(user.id);};
    const timer=setInterval(refresh,60000);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{generation.current++;for(const controller of controllers.current.values())controller.abort();controllers.current.clear();clearInterval(timer);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[userIds,enabled]);
  async function mutate(file:MobileDriveFile,patch:{starred?:boolean;trashed?:boolean;name?:string}) {
    if(patch.name!==undefined&&file.canEdit===false)throw new Error('This account cannot rename this item.');
    if(controllers.current.has(file.account))throw new Error('Wait for this account to finish syncing, then try again.');
    if(patch.trashed===true && file.canTrash===false || patch.trashed===false && file.canUntrash===false)throw new Error('This account does not have permission to change this file’s Trash state.');
    const epoch=generation.current;const controller=new AbortController();controllers.current.set(file.account,controller);state(file.account,{syncing:true});
    try {
      const raw=await mobileDriveClient.update(file.account,file.rawId,patch,controller.signal);
      if(epoch!==generation.current)return;
      const before=latest.current[file.account];if(!before)return;
      const snapshot={...before,files:before.files.map(item=>item.id===raw.id?raw:item)};apply(snapshot);await saveSnapshot(snapshot).catch(()=>{});
    } catch(error) {if(epoch===generation.current && error instanceof DriveConsentRequired){blocked.current.add(file.account);state(file.account,{needsAccess:true,error:error.message});}throw error;}
    finally {if(controllers.current.get(file.account)===controller)controllers.current.delete(file.account);if(epoch===generation.current)state(file.account,{syncing:false});}
  }
  async function create(account:string,name:string,parent?:string) {
    const before=latest.current[account];if(!before)throw new Error('Connect Drive and finish syncing this account first.');
    if(controllers.current.has(account))throw new Error('Wait for sync to finish, then try again.');
    const epoch=generation.current;const controller=new AbortController();controllers.current.set(account,controller);state(account,{syncing:true});
    try {
      const raw=await mobileDriveClient.createFolder(account,name,parent || before.root,controller.signal);
      if(epoch!==generation.current)return;
      const snapshot={...latest.current[account],files:[...latest.current[account].files,raw]};apply(snapshot);await saveSnapshot(snapshot).catch(()=>{});
    } catch(error) {if(epoch===generation.current && error instanceof DriveConsentRequired){blocked.current.add(account);state(account,{needsAccess:true,error:error.message});}throw error;}
    finally {if(controllers.current.get(account)===controller)controllers.current.delete(account);if(epoch===generation.current)state(account,{syncing:false});}
  }
  async function clear() {
    generation.current++;for(const controller of controllers.current.values())controller.abort();controllers.current.clear();blocked.current.clear();latest.current={};setSnapshots({});setStates({});await clearSnapshots().catch(()=>{});
  }
  async function refresh(account?:string){const epoch=generation.current;await Promise.all((account?[account]:users.map(user=>user.id)).map(async id=>{const until=Date.now()+90000;while(controllers.current.has(id)&&epoch===generation.current&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,100));if(epoch===generation.current)await sync(id);}));}
  const files=useMemo(()=>Object.values(snapshots).flatMap(mapSnapshot),[snapshots]);
  return {files,snapshots,states,refresh,syncing:Object.values(states).some(state=>state.syncing),sync:(account?:string)=>account?sync(account):Promise.all(users.map(user=>sync(user.id))).then(()=>{}),connect:(account:string)=>sync(account,true),mutate,create,clear};
}
