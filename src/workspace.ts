import { useState } from 'react';
import { ArrowLeftRight, CloudOff, Clock3, Folder, HardDrive, House, Star, Trash2, Users } from 'lucide-react';
import type { DriveFile } from './data';

export type Page = 'Home' | 'My files' | 'Shared with me' | 'Starred' | 'Recent' | 'Trash' | 'Storage' | 'Settings' | 'Transfers' | 'Offline files';
export const navigation = [{ name: 'Home', icon: House }, { name: 'My files', icon: Folder }, { name: 'Shared with me', icon: Users }, { name: 'Starred', icon: Star }, { name: 'Recent', icon: Clock3 }, { name: 'Trash', icon: Trash2 }, { name: 'Storage', icon: HardDrive }, {name:'Transfers',icon:ArrowLeftRight}, {name:'Offline files',icon:CloudOff}] satisfies { name: Page; icon: typeof House }[];
export type SidebarPreferences = { order: Page[]; hidden: Page[]; showPins: boolean; compact: boolean; wide: boolean; transfersConfigured?: boolean };
export const defaultSidebar: SidebarPreferences = { order: navigation.map(item => item.name), hidden: ['Transfers'], transfersConfigured:true, showPins: true, compact: false, wide: false };
type Location = { page: Page; folder: string | null; scope: string };
export function useWorkspaceNavigation() {
  const [state, setState] = useState<{ entries: Location[]; index: number }>({ entries: [{ page: 'Home', folder: null, scope: 'all' }], index: 0 });
  const go = (patch: Partial<Location>) => setState(old => {
    const next = { ...old.entries[old.index], ...patch };
    if (JSON.stringify(next) === JSON.stringify(old.entries[old.index])) return old;
    return { entries: [...old.entries.slice(0, old.index + 1), next], index: old.index + 1 };
  });
  return { current: state.entries[state.index], go, canBack: state.index > 0, canForward: state.index < state.entries.length - 1,
    back: () => setState(old => ({ ...old, index: Math.max(0, old.index - 1) })),
    forward: () => setState(old => ({ ...old, index: Math.min(old.entries.length - 1, old.index + 1) })) };
}
export function ancestors(id: string | null, files: DriveFile[]): DriveFile[] {
  const result: DriveFile[] = []; const visited = new Set<string>();
  let current = files.find(file => file.id === id);
  while (current && !visited.has(current.id)) { visited.add(current.id); result.unshift(current); current = files.find(file => file.id === current?.parent); }
  return result;
}
export function isAvailable(file: DriveFile, files: DriveFile[]) { return !file.trashed && ancestors(file.parent || null, files).every(parent => !parent.trashed); }
