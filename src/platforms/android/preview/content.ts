import type {DriveFile} from '../../../data';
import type {MobileDriveFile} from '../drive/model';
import {driveAccessToken,DriveConsentRequired,forgetDriveToken} from '../auth/nativeGoogle';
import {offlinePreview} from '../offline/native';
export const MAX_PREVIEW_BYTES=32*1024*1024;
export async function boundedBlob(response:Response,signal:AbortSignal,onProgress?:(received:number,total:number)=>void):Promise<Blob>{
  if(!response.ok)throw new Error(`File could not be loaded (${response.status}).`);
  const length=Number(response.headers.get('Content-Length')||0);if(length>MAX_PREVIEW_BYTES){await response.body?.cancel();throw new Error('Previews support files up to 32 MB.');}
  if(!response.body)throw new Error('The preview stream is unavailable.');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0,lastProgress=0;
  try{while(true){if(signal.aborted)throw new DOMException('Preview cancelled','AbortError');const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_PREVIEW_BYTES)throw new Error('Previews support files up to 32 MB.');chunks.push(value);if(Date.now()-lastProgress>=80){onProgress?.(size,length);lastProgress=Date.now();}}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  onProgress?.(size,length);
  return new Blob(chunks,{type:response.headers.get('Content-Type') || 'application/octet-stream'});
}
const previewCache=new Map<string,{blob:Blob;time:number}>();let cacheGeneration=0;
const cacheKey=(file:DriveFile)=>[file.account,file.id,file.modified,file.byteSize,file.mimeType,file.offline?'offline':'online'].join('|');
export function clearPreviewCache(){previewCache.clear();cacheGeneration++;}
function remember(key:string,blob:Blob){previewCache.delete(key);previewCache.set(key,{blob,time:Date.now()});let bytes=[...previewCache.values()].reduce((sum,item)=>sum+item.blob.size,0);for(const [id,item] of previewCache){if(bytes<=48*1024*1024 && previewCache.size<=3)break;previewCache.delete(id);bytes-=item.blob.size;}}
function present(file:DriveFile,blob:Blob,releaseNative?:()=>Promise<void>){const url=URL.createObjectURL(blob);const pdf=blob.type.includes('application/pdf');return {url,blob,mime:blob.type,file:{...file,url,type:pdf?'pdf' as const:file.type,name:pdf&&!file.name.toLowerCase().endsWith('.pdf')?file.name+'.pdf':file.name,size:blob.size+' B',byteSize:blob.size,mimeType:blob.type},release:()=>{URL.revokeObjectURL(url);void releaseNative?.();}};}
export async function previewContent(file:DriveFile,signal:AbortSignal,onProgress?:(received:number,total:number)=>void):Promise<ReturnType<typeof present>>{
  if(file.type==='folder')throw new Error('Open this folder to view its contents.');
  if((file.byteSize||0)>MAX_PREVIEW_BYTES)throw new Error('Previews support files up to 32 MB.');
  const key=cacheKey(file),epoch=cacheGeneration;const cached=previewCache.get(key);if(cached&&Date.now()-cached.time<5*60*1000){if(signal.aborted)throw new DOMException('Preview cancelled','AbortError');remember(key,cached.blob);onProgress?.(cached.blob.size,cached.blob.size);return present(file,cached.blob);}if(cached)previewCache.delete(key);
  let response:Response,releaseNative:(()=>Promise<void>)|undefined,forcedMime:string|undefined;
  if(file.offline){const local=await offlinePreview(file.id);releaseNative=local.release;forcedMime=local.mime;try{response=await fetch(local.url,{signal});}catch(error){await releaseNative();throw error;}}
  else if(file.remote){const remote=file as MobileDriveFile;if(remote.canDownload===false)throw new Error('The owner does not allow this file to be previewed.');const token=await driveAccessToken(file.account);if(signal.aborted)throw new DOMException('Preview cancelled','AbortError');const exportPdf=!!file.mimeType?.startsWith('application/vnd.google-apps.');const url=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remote.rawId)}${exportPdf?'/export?mimeType=application%2Fpdf':'?alt=media&supportsAllDrives=true'}`;response=await fetch(url,{headers:{Authorization:`Bearer ${token}`,...(remote.resourceKey?{'X-Goog-Drive-Resource-Keys':remote.rawId+'/'+remote.resourceKey}:{})},signal});if(response.status===401||response.status===403){const problem=await response.json().catch(()=>({}));const reasons=JSON.stringify(problem);if(response.status===401||/insufficientPermissions|insufficient_scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reasons)){forgetDriveToken(file.account);throw new DriveConsentRequired('Drive access is required to preview this file.');}throw new Error(/exportSizeLimitExceeded/i.test(reasons)?'Google limits exported documents to 10 MB. Open this document in Google Drive.':problem.error?.message||'The file owner or Google Drive does not allow this preview.');}}
  else if(file.url?.startsWith('blob:'))response=await fetch(file.url,{signal});
  else throw new Error('This demo file has no content. Preview a synced file instead.');
  try{let blob=await boundedBlob(response,signal,onProgress);if(forcedMime)blob=new Blob([blob],{type:forcedMime});if(signal.aborted)throw new DOMException('Preview cancelled','AbortError');if(epoch===cacheGeneration)remember(key,blob);return present(file,blob,releaseNative);}catch(error){await releaseNative?.();throw error;}
}
