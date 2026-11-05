import type {DriveFile} from './data';
import {ancestors} from './workspace';
export function removableShare(file:DriveFile,files:DriveFile[]):boolean{return !file.trashed&&file.canTrash!==true&&(!!file.shared||ancestors(file.parent||null,files).some(parent=>parent.shared));}
export function removedFromSharedView(file:DriveFile,files:DriveFile[],removed:string[]):boolean{const ids=new Set(removed);return ids.has(file.id)||ancestors(file.parent||null,files).some(parent=>ids.has(parent.id));}
