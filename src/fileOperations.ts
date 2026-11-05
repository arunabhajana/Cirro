import type { AccountId, DriveFile } from './data';
import { ancestors, isAvailable } from './workspace';

export function pasteFiles(files: DriveFile[], ids: string[], mode: 'copy' | 'cut', destination: string | null, account: AccountId): DriveFile[] {
  const roots = files.filter(file => ids.includes(file.id) && isAvailable(file, files) && !ancestors(file.parent || null, files).some(parent => ids.includes(parent.id)));
  if (!roots.length) throw new Error('These items are no longer available.');
  if (roots.some(root=>root.account!==account)) throw new Error('Copying or moving between Google accounts is not supported yet. Download and upload the files to the destination account instead.');
  if (roots.some(root => root.id === destination || ancestors(destination, files).some(parent => parent.id === root.id))) throw new Error('A folder cannot be placed inside itself.');
  if (mode === 'cut' && roots.some(root => root.parent === (destination || undefined) && root.account === account)) throw new Error('These items are already in this folder.');
  if (mode === 'cut' && roots.some(root => files.some(file => !file.trashed && !roots.some(item => item.id === file.id) && file.account === account && file.parent === (destination || undefined) && file.name.toLowerCase() === root.name.toLowerCase()))) throw new Error('An item with this name already exists in the destination. Rename it before moving.');
  const tree = files.filter(file => isAvailable(file, files) && roots.some(root => root.id === file.id || ancestors(file.parent || null, files).some(parent => parent.id === root.id)));
  if (mode === 'cut') return files.map(file => tree.some(item => item.id === file.id) ? { ...file, account, ...(roots.some(root => root.id === file.id) ? { parent: destination || undefined, modified: 'Just now' } : {}) } : file);
  const newIds = new Map(tree.map(file => [file.id, crypto.randomUUID()]));
  const occupied = new Set(files.filter(file => file.account === account && file.parent === (destination || undefined)).map(file => file.name.toLowerCase()));
  const copies = tree.map(file => {
    const root = roots.some(root => root.id === file.id);
    let name = file.name;
    if (root) {
      const dot = file.type === 'folder' ? -1 : name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name; const extension = dot > 0 ? name.slice(dot) : '';
      let number = 1;
      while (occupied.has(name.toLowerCase())) name = `${stem} copy${number++ > 1 ? ` ${number - 1}` : ''}${extension}`;
      occupied.add(name.toLowerCase());
    }
    return { ...file, id: newIds.get(file.id)!, copySource:file.id, name, account, parent: root ? destination || undefined : newIds.get(file.parent!)!, modified: 'Just now' };
  });
  return [...copies, ...files];
}
