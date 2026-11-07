import { DriveConsentRequired, driveAccessToken, forgetDriveToken } from '../auth/nativeGoogle';
import { FILE_FIELDS, FOLDER, type RemoteFile, type Snapshot } from './model';

export class DriveApiError extends Error { constructor(message:string, public status:number) { super(message); } }
type Params = Record<string,string>;
type Page = {files?:RemoteFile[];drives?:{id:string;name:string}[];nextPageToken?:string;incompleteSearch?:boolean};
export class DriveClient {
  constructor(private token: (account:string)=>Promise<string> = driveAccessToken, private transport:typeof fetch = (...args) => fetch(...args)) {}
  async request<T>(account:string,path:string,params:Params={},signal?:AbortSignal,method='GET',body?:unknown):Promise<T> {
    const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
    url.search = new URLSearchParams(params).toString();
    const token = await this.token(account);
    for(let attempt=0;;attempt++) {
      const response = await this.transport(url.href,{method,headers:{Authorization:`Bearer ${token}`,...(body ? {'Content-Type':'application/json'} : {})},body:body ? JSON.stringify(body) : undefined,signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)});
      const data = response.status===204?{}:await response.json();
      if(response.ok) return data as T;
      const reasons = JSON.stringify(data?.error?.errors || data?.error?.details || []);
      if(response.status===401 || response.status===403 && /insufficientPermissions|insufficient_scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reasons)) {
        forgetDriveToken(account); throw new DriveConsentRequired('Drive access needs approval or has expired. Connect Drive to continue.');
      }
      if((method==='GET' || method==='PATCH') && (response.status===429 || response.status>=500 || /rateLimitExceeded|userRateLimitExceeded/.test(reasons)) && attempt<2) {
        await new Promise<void>((resolve,reject)=>{const timer=setTimeout(done,500*2**attempt);function done(){signal?.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);reject(new DOMException('Sync cancelled','AbortError'));}signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();});
        continue;
      }
      throw new DriveApiError(typeof data?.error?.message==='string'?data.error.message:`Google Drive request failed (${response.status}).`,response.status);
    }
  }
  async pages(account:string,path:string,params:Params,signal?:AbortSignal):Promise<Page> {
    const output:Page={files:[],drives:[]};const seen=new Set<string>();let next='';
    do {
      const page=await this.request<Page>(account,path,{...params,...(next?{pageToken:next}:{})},signal);
      if(page.incompleteSearch) throw new Error('Google returned an incomplete file listing. Retry sync to keep the previous complete snapshot.');
      output.files!.push(...page.files || []);output.drives!.push(...page.drives || []);
      next=page.nextPageToken || '';if(next && seen.has(next))throw new Error('Google returned a repeated page token. Retry sync.');seen.add(next);
    } while(next);
    return output;
  }
  async sync(account:string,previous?:Snapshot,signal?:AbortSignal):Promise<Snapshot> {
    const [root,about,drivePage] = await Promise.all([
      this.request<{id:string}>(account,'files/root',{fields:'id'},signal),
      this.request<{storageQuota:{usage?:string;limit?:string}}>(account,'about',{fields:'storageQuota'},signal),
      this.pages(account,'drives',{pageSize:'100',fields:'nextPageToken,drives(id,name)'},signal),
    ]);
    const drives=drivePage.drives || [];
    const streams=['user',...drives.map(drive=>drive.id)];
    const sameDrives=previous && previous.drives.map(drive=>drive.id).sort().join(',')===drives.map(drive=>drive.id).sort().join(',');
    const canIncrement=previous?.tokens && previous.root===root.id && sameDrives && Date.now()-Date.parse(previous.fullSyncedAt || previous.syncedAt)<15*60*1000 && streams.every(stream=>previous.tokens?.[stream]);
    let files:Map<string,RemoteFile>;
    let tokens:Record<string,string>={};
    if(canIncrement) {
      files=new Map(previous.files.map(file=>[file.id,file]));
      try { for(const stream of streams) tokens[stream]=await this.changes(account,stream,previous.tokens![stream],files,signal); }
      catch(error) { if(!(error instanceof DriveApiError && error.status===410))throw error;return this.sync(account,undefined,signal); }
      // Newly shared folders may expose descendants absent from the user corpus.
      const freshShares=[...files.values()].filter(file=>file.sharedWithMeTime && file.mimeType===FOLDER && !previous.files.some(old=>old.id===file.id && old.sharedWithMeTime));
      await this.sharedFolders(account,files,freshShares,signal);
    } else {
      files=new Map();
      for(const stream of streams) {
        tokens[stream]=(await this.request<{startPageToken:string}>(account,'changes/startPageToken',{supportsAllDrives:'true',...(stream==='user'?{}:{driveId:stream})},signal)).startPageToken;
        const page=await this.pages(account,'files',{spaces:'drive',pageSize:'1000',fields:`nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(stream==='user'?{corpora:'user'}:{corpora:'drive',driveId:stream})},signal);
        for(const file of page.files || [])files.set(file.id,file);
      }
      await this.sharedFolders(account,files,[...files.values()].filter(file=>file.sharedWithMeTime && file.mimeType===FOLDER),signal);
      const knownShares=new Set([...files.values()].filter(file=>file.sharedWithMeTime).map(file=>file.id));
      // Replay changes since BEFORE enumeration to cover modifications during paging.
      for(const stream of streams)tokens[stream]=await this.changes(account,stream,tokens[stream],files,signal);
      await this.sharedFolders(account,files,[...files.values()].filter(file=>file.sharedWithMeTime && file.mimeType===FOLDER && !knownShares.has(file.id)),signal);
    }
    return {account,root:root.id,files:[...files.values()],drives,tokens,quota:{used:Number(about.storageQuota?.usage || 0),total:about.storageQuota?.limit?Number(about.storageQuota.limit):null},syncedAt:new Date().toISOString(),fullSyncedAt:canIncrement?previous?.fullSyncedAt || previous?.syncedAt:new Date().toISOString()};
  }
  private async sharedFolders(account:string,files:Map<string,RemoteFile>,queue:RemoteFile[],signal?:AbortSignal) {
    const visited=new Set<string>();
    for(let index=0;index<queue.length;index++) {
      const folder=queue[index];if(visited.has(folder.id)||folder.trashed)continue;visited.add(folder.id);
      const page=await this.pages(account,'files',{q:`'${folder.id.replace(/'/g,"\\'")}' in parents`,pageSize:'1000',fields:`nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,supportsAllDrives:'true',includeItemsFromAllDrives:'true'},signal);
      for(const file of page.files || []) { files.set(file.id,file);if(file.mimeType===FOLDER)queue.push(file); }
    }
  }
  private async changes(account:string,stream:string,start:string,files:Map<string,RemoteFile>,signal?:AbortSignal):Promise<string> {
    let next=start;const seen=new Set<string>();
    while(next) {
      if(seen.has(next))throw new Error('Google returned a repeated change token. Retry sync.');seen.add(next);
      const page=await this.request<{changes:{fileId:string;removed?:boolean;file?:RemoteFile}[];nextPageToken?:string;newStartPageToken?:string}>(account,'changes',{pageToken:next,pageSize:'1000',spaces:'drive',includeRemoved:'true',includeCorpusRemovals:'true',supportsAllDrives:'true',includeItemsFromAllDrives:'true',fields:`nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,...(stream==='user'?{}:{driveId:stream})},signal);
      for(const change of page.changes || []) {
        if(change.removed){const removed=new Set([change.fileId]);let grew=true;while(grew){grew=false;for(const file of files.values())if(file.parents?.some(parent=>removed.has(parent)) && !file.ownedByMe && !file.sharedWithMeTime && !removed.has(file.id)){removed.add(file.id);grew=true;}}for(const id of removed)files.delete(id);}
        else if(change.file)files.set(change.fileId,change.file);
      }
      if(!page.nextPageToken) { if(!page.newStartPageToken)throw new Error('Google did not return a sync cursor. Retry sync.');return page.newStartPageToken; }
      next=page.nextPageToken;
    }
    throw new Error('Missing Drive change cursor.');
  }
  async update(account:string,id:string,patch:{starred?:boolean;trashed?:boolean;name?:string},signal?:AbortSignal) {
    return this.request<RemoteFile>(account,`files/${encodeURIComponent(id)}`,{supportsAllDrives:'true',fields:FILE_FIELDS},signal,'PATCH',patch);
  }
  async getFile(account:string,id:string,signal?:AbortSignal){return this.request<RemoteFile>(account,`files/${encodeURIComponent(id)}`,{supportsAllDrives:'true',fields:FILE_FIELDS},signal);}
  async children(account:string,id:string,signal?:AbortSignal){return (await this.pages(account,'files',{q:`'${id.replace(/'/g,"\\'")}' in parents and trashed=false`,pageSize:'1000',fields:`nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,supportsAllDrives:'true',includeItemsFromAllDrives:'true'},signal)).files||[];}
  async move(account:string,file:RemoteFile,parent:string,signal?:AbortSignal){return this.request<RemoteFile>(account,`files/${encodeURIComponent(file.id)}`,{supportsAllDrives:'true',fields:FILE_FIELDS,addParents:parent,...(file.parents?.length?{removeParents:file.parents.join(',')}:{})},signal,'PATCH',{});}
  async copy(account:string,file:RemoteFile,parent:string,marker:string,signal?:AbortSignal){return this.request<RemoteFile>(account,`files/${encodeURIComponent(file.id)}/copy`,{supportsAllDrives:'true',fields:FILE_FIELDS},signal,'POST',{name:file.name,parents:[parent],appProperties:{cirroTransfer:marker}});}
  async deleteFile(account:string,id:string,signal?:AbortSignal){await this.request(account,`files/${encodeURIComponent(id)}`,{supportsAllDrives:'true'},signal,'DELETE');}
  async marked(account:string,parent:string,marker:string,signal?:AbortSignal){const files=(await this.pages(account,'files',{q:`'${parent.replace(/'/g,"\\'")}' in parents and trashed=false and appProperties has { key='cirroTransfer' and value='${marker.replace(/'/g,"\\'")}' }`,pageSize:'1000',fields:`nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,supportsAllDrives:'true',includeItemsFromAllDrives:'true'},signal)).files||[];if(files.length>1)throw new Error('Multiple destination copies were found. Source retained.');return files[0];}
  async createFolder(account:string,name:string,parent:string,signal?:AbortSignal,marker?:string) {
    return this.request<RemoteFile>(account,'files',{supportsAllDrives:'true',fields:FILE_FIELDS},signal,'POST',{name,mimeType:FOLDER,parents:[parent],...(marker?{appProperties:{cirroTransfer:marker}}:{})});
  }
}
export const mobileDriveClient = new DriveClient();
