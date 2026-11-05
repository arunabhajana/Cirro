import type {DriveFile} from './data';
export function trashPermission(file:DriveFile):boolean|undefined{return file.trashed?file.canUntrash:file.canTrash;}
export function trashPermissionMessage(file:DriveFile,account:string){return `${account} cannot ${file.trashed?'restore':'move to Trash'} “${file.name}”. This account does not have the required file permission. Reconnecting does not change ownership or sharing permissions.`;}
