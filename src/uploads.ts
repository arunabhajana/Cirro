import type { AccountId, DriveFile } from './data';
import { describeFile } from './fileTypes';

export function prepareUploads(selected: File[], account: AccountId, destination: string, preserveFolders: boolean): DriveFile[] {
  const folders = new Map<string, DriveFile>();
  const entries: DriveFile[] = [];
  for (const file of selected) {
    const path = preserveFolders ? (file.webkitRelativePath || file.name).split('/').filter(part => part && part !== '.' && part !== '..') : [file.name];
    let parent = destination === 'root' ? undefined : destination;
    for (let index = 0; index < path.length - 1; index++) {
      const key = path.slice(0, index + 1).join('/');
      let folder = folders.get(key);
      if (!folder) {
        folder = { id: crypto.randomUUID(), name: path[index], type: 'folder', account, parent, color: 'blue', size: '0 B', items: 0, modified: 'Just now' };
        folders.set(key, folder);
        entries.push(folder);
      }
      parent = folder.id;
    }
    const info = describeFile({ name: file.name, type: 'unknown', mimeType: file.type });
    entries.push({ id: crypto.randomUUID(), name: file.name, type: info.kind, mimeType: file.type, account, parent, size: file.size > 1e6 ? `${(file.size / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1000))} KB`, modified: 'Just now', color: info.color, url: URL.createObjectURL(file) });
  }
  for (const folder of folders.values()) folder.items = entries.filter(entry => entry.parent === folder.id).length;
  return entries;
}
