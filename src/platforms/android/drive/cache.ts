import type { Snapshot } from './model';
let opening:Promise<IDBDatabase>|undefined;
function database() {
  opening ??= new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('cirro-android-drive',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('accounts',{keyPath:'account'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  }).catch(error=>{opening=undefined;throw error;});
  return opening;
}
export async function readSnapshot(account:string):Promise<Snapshot|undefined> {
  const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('accounts').objectStore('accounts').get(account);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
export async function saveSnapshot(snapshot:Snapshot) {
  const db=await database();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(snapshot);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}
export async function clearSnapshots() {
  const db=await database();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}
