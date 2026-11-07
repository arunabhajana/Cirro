import {Capacitor,registerPlugin,type PluginListenerHandle} from '@capacitor/core';
import {driveAccessToken,DriveConsentRequired} from '../auth/nativeGoogle';
import type {MobileDriveFile} from '../drive/model';
export type OfflineRecord={key:string;account:string;rawId:string;name:string;downloadName:string;mime:string;size:number;modified:string;savedAt:number};
const plugin=registerPlugin<{addListener(name:'progress',callback:(event:{key:string;bytes:number;total:number})=>void):Promise<PluginListenerHandle>;getLocation():Promise<{name:string;custom:boolean}>;chooseLocation():Promise<{name:string;custom:boolean;cancelled?:boolean}>;useAppStorage():Promise<{name:string;custom:boolean}>;listFiles():Promise<{files:OfflineRecord[]}>;saveFile(options:Record<string,unknown>):Promise<OfflineRecord>;removeFile(options:{key:string}):Promise<void>;cancelFile(options:{key:string}):Promise<void>;openFile(options:{key:string}):Promise<void>;previewFile(options:{key:string}):Promise<{path:string;mime:string}>;releasePreview(options:{path:string}):Promise<void>}>('OfflineFiles');
export const offlineAvailable=()=>Capacitor.isNativePlatform()&&Capacitor.isPluginAvailable('OfflineFiles');
export async function listOffline(){return offlineAvailable()?(await plugin.listFiles()).files:[];}
export async function getOfflineLocation(){return offlineAvailable()?plugin.getLocation():{name:'App storage',custom:false};}
export async function chooseOfflineLocation(){if(!offlineAvailable())throw new Error('Folder selection is available in the updated Android app.');return plugin.chooseLocation();}
export async function useAppOfflineStorage(){return plugin.useAppStorage();}
export async function saveOffline(file:MobileDriveFile,signal?:AbortSignal,onProgress?:(bytes:number,total:number)=>void){
  if(!offlineAvailable())throw new Error('Offline downloads require the updated Android app.');
  if(file.type==='folder')throw new Error('Choose the files inside this folder to save them offline.');
  if(file.canDownload===false)throw new Error('The owner does not allow this file to be downloaded.');
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const token=await driveAccessToken(file.account);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  let listener:PluginListenerHandle|undefined;
  if(onProgress)listener=await plugin.addListener('progress',event=>{if(event.key===file.id)onProgress(event.bytes,event.total);});
  const cancel=()=>void plugin.cancelFile({key:file.id}).catch(()=>{});signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  try{return await plugin.saveFile({account:file.account,id:file.rawId,name:file.name,mime:file.mimeType,token,exportPdf:!!file.mimeType?.startsWith('application/vnd.google-apps.'),modified:file.modified,resourceKey:file.resourceKey});}
  catch(error){if((error as {code?:string}).code==='DRIVE_CONSENT_REQUIRED')throw new DriveConsentRequired('Connect Drive to download this file.');throw error;}finally{signal?.removeEventListener('abort',cancel);await listener?.remove();}
}
export async function removeOffline(key:string){await plugin.removeFile({key});}
export async function openOffline(key:string){await plugin.openFile({key});}
export async function offlinePreview(key:string){const file=await plugin.previewFile({key});return {url:Capacitor.convertFileSrc(file.path),mime:file.mime,release:()=>plugin.releasePreview({path:file.path}).catch(()=>{})};}
