import type { DriveFile } from '../../../data';

export type RemoteFile = {
  id: string; name: string; mimeType: string;version?:string;md5Checksum?:string; parents?: string[]; size?: string;
  modifiedTime?: string; viewedByMeTime?: string; starred?: boolean; trashed?: boolean;
  explicitlyTrashed?: boolean; sharedWithMeTime?: string; driveId?: string;
  webViewLink?: string; ownedByMe?: boolean; resourceKey?:string;
  capabilities?: { canTrash?: boolean; canUntrash?: boolean; canEdit?: boolean; canAddChildren?: boolean;canDownload?:boolean;canCopy?:boolean;canShare?:boolean;canDelete?:boolean;canMoveItemWithinDrive?:boolean };
  appProperties?: Record<string, string>;
};
export type MobileDriveFile = DriveFile & { rawId: string; viewedAt?: string; canEdit?: boolean; canAddChildren?: boolean; sharedDriveRoot?: boolean;canDownload?:boolean;resourceKey?:string;canCopy?:boolean;canShare?:boolean;canDelete?:boolean;driveId?:string };
export type Quota = { used: number; total: number | null };
export type Snapshot = { account: string; root: string; files: RemoteFile[]; drives: {id:string;name:string}[]; quota: Quota; syncedAt: string; fullSyncedAt?:string; tokens?: Record<string,string> };
export const FOLDER = 'application/vnd.google-apps.folder';
export const FILE_FIELDS = 'id,name,mimeType,parents,size,version,md5Checksum,modifiedTime,viewedByMeTime,starred,trashed,explicitlyTrashed,sharedWithMeTime,driveId,webViewLink,ownedByMe,resourceKey,capabilities(canTrash,canUntrash,canEdit,canAddChildren,canDownload,canCopy,canShare,canDelete,canMoveItemWithinDrive),appProperties';
export const scopedId = (account: string, id: string) => `${account}:${id}`;

export function formatBytes(bytes:number){
 const value=Number.isFinite(bytes)?Math.max(0,bytes):0;const units=['B','KB','MB','GB','TB','PB','EB'];let unit=value>0?Math.max(0,Math.min(units.length-1,Math.floor(Math.log10(value)/3))):0;
 if(unit<units.length-1 && Number((value/1000**unit).toFixed(1))>=1000)unit++;
 return new Intl.NumberFormat('en',{maximumFractionDigits:1}).format(value/1000**unit)+' '+units[unit];
}
export const formatGigabytes=(gb:number)=>formatBytes(gb*1e9);
function fileKind(file: RemoteFile): DriveFile['type'] {
  if (file.mimeType === FOLDER) return 'folder';
  const google = file.mimeType.replace('application/vnd.google-apps.', '');
  const kinds: Record<string, DriveFile['type']> = { document:'doc',spreadsheet:'sheet',presentation:'slides',drawing:'design' };
  if (kinds[google]) return kinds[google];
  if (file.mimeType.startsWith('image/')) return 'image';
  if (file.mimeType.startsWith('video/')) return 'video';
  if (file.mimeType.startsWith('audio/')) return 'audio';
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  for (const [kind,extensions] of Object.entries({pdf:['pdf'],doc:['doc','docx','odt','rtf'],sheet:['xlsx','xls','csv','ods'],slides:['ppt','pptx','odp'],archive:['zip','rar','7z','tar','gz'],code:['js','ts','tsx','py','rs','json','html','css'],text:['txt','md','log'],design:['fig','sketch','xd']})) if (extensions.includes(ext)) return kind as DriveFile['type'];
  return file.mimeType.startsWith('text/') ? 'text' : 'unknown';
}

export function mapSnapshot(snapshot: Snapshot): MobileDriveFile[] {
  const {account,root} = snapshot;
  const raw = new Map(snapshot.files.map(file => [file.id,file]));
  const driveRoots = new Set(snapshot.drives.map(drive => drive.id));
  const ancestry = (file: RemoteFile, predicate: (file: RemoteFile) => boolean) => {
    const seen = new Set<string>(); let current: RemoteFile | undefined = file;
    while (current && !seen.has(current.id)) { seen.add(current.id); if (predicate(current)) return true; current = raw.get(current.parents?.[0] || ''); }
    return false;
  };
  const files: MobileDriveFile[] = snapshot.files.filter(file => file.id !== root).map(file => {
    const type = fileKind(file);
    const parent = file.parents?.[0];
    return {
      id:scopedId(account,file.id),rawId:file.id,account,name:file.name,type,
      parent:parent && parent !== root ? scopedId(account,parent) : undefined,
      size:type === 'folder' ? '' : formatBytes(Number(file.size || 0)),byteSize:Number(file.size || 0),
      modified:file.modifiedTime || '', viewedAt:file.viewedByMeTime,
      starred:!!file.starred, trashed:ancestry(file,item => !!item.trashed),
      shared:ancestry(file,item => !!item.sharedWithMeTime),
      inMyDrive:ancestry(file,item => item.parents?.includes(root) === true || driveRoots.has(item.id) || driveRoots.has(item.driveId || '') || item.parents?.some(parent=>driveRoots.has(parent))===true),
      canTrash:file.capabilities?.canTrash,canUntrash:file.capabilities?.canUntrash,
      canEdit:file.capabilities?.canEdit,canAddChildren:file.capabilities?.canAddChildren,
      canDownload:file.capabilities?.canDownload,resourceKey:file.resourceKey,canCopy:file.capabilities?.canCopy,canShare:file.capabilities?.canShare,canDelete:file.capabilities?.canDelete,driveId:file.driveId,
      remote:true,mimeType:file.mimeType,webViewLink:file.webViewLink,
      color:file.appProperties?.cirroColor || 'blue',
    };
  });
  for (const drive of snapshot.drives) {
    const existing = files.find(file => file.rawId === drive.id);
    if (existing) { existing.parent = undefined; existing.inMyDrive = true; existing.sharedDriveRoot = true; }
    else files.push({id:scopedId(account,drive.id),rawId:drive.id,account,name:drive.name,type:'folder',size:'',modified:'',color:'blue',remote:true,inMyDrive:true,canTrash:false,canUntrash:false,sharedDriveRoot:true});
  }
  const counts=new Map<string,number>();for(const child of files)if(child.parent && !child.trashed)counts.set(child.parent,(counts.get(child.parent)||0)+1);
  for (const file of files) if (file.type === 'folder') { file.items=counts.get(file.id)||0;file.size=`${file.items} ${file.items===1?'item':'items'}`; }
  return files;
}
