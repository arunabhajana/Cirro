import type { DriveFile } from './data';
import { accounts } from './data';
import { ancestors } from './workspace';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function matchesFileSearch(file: DriveFile, query: string, files: DriveFile[]): boolean {
  const account = accounts.find(account => account.id === file.account);
  const path = ancestors(file.parent || null, files).map(parent => parent.name).join(' / ');
  const extension = file.name.includes('.') ? file.name.split('.').pop()! : '';
  const terms = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return terms.every(raw => {
    const term = normalize(raw.replaceAll('"', ''));
    if (term.startsWith('account:')) return normalize(`${account?.name} ${account?.email}`).includes(term.slice(8));
    if (term.startsWith('in:')) return normalize(path).includes(term.slice(3));
    if (term.startsWith('type:')) {
      const value = term.slice(5);
      if (value === 'document') return ['doc', 'pdf', 'sheet'].includes(file.type);
      if (value === 'photo') return file.type === 'image';
      return file.type === value || normalize(extension) === value;
    }
    return normalize(`${file.name} ${account?.name} ${account?.email} ${file.type} ${path}`).includes(term);
  });
}
