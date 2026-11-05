import type { FolderStyle } from './folderStyles';
export type AccountId = string;
export type DriveFile = {
  uploadConflict?: 'keep'|'replace'|'ask';offlineStale?:boolean; id: string; name: string; type: 'folder' | 'pdf' | 'sheet' | 'image' | 'video' | 'doc' | 'audio' | 'code' | 'archive' | 'slides' | 'text' | 'design' | 'font' | 'model' | 'database' | 'mail' | 'calendar' | 'contact' | 'executable' | 'unknown'; account: AccountId; size: string; modified: string; color: string; items?: number; parent?: string; starred?: boolean; shared?: boolean; inMyDrive?:boolean; trashed?: boolean; canTrash?:boolean; canUntrash?:boolean; url?: string; byteSize?:number; offlinePartial?:boolean; offline?:boolean; previewOffline?:boolean; previewStale?:boolean; previewError?:string; previewLoading?: boolean; remote?: boolean; webViewLink?: string; thumbnail?: boolean; copySource?: string; mimeType?: string; folderStyle?: FolderStyle };
export const accounts: {id:AccountId;name:string;email:string;initials:string;used:number;total:number;color:string}[] = [{id:'personal',name:'Google Drive',email:'',initials:'',used:0,total:0,color:'#4389f5'}];
export const initialFiles:DriveFile[]=[];
