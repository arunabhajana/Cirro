import { ArrowLeftRight, CloudOff, Clock3, Folder, HardDrive, House, Star, Trash2, Users } from 'lucide-react';

export type Page = 'Home' | 'My files' | 'Shared with me' | 'Starred' | 'Recent' | 'Trash' | 'Storage' | 'Settings' | 'Transfers' | 'Offline files';
export const navigation = [
  { name: 'Home', icon: House }, { name: 'My files', icon: Folder },
  { name: 'Shared with me', icon: Users }, { name: 'Starred', icon: Star },
  { name: 'Recent', icon: Clock3 }, { name: 'Trash', icon: Trash2 },
  { name: 'Storage', icon: HardDrive }, { name: 'Transfers', icon: ArrowLeftRight },
  { name: 'Offline files', icon: CloudOff },
] satisfies { name: Page; icon: typeof House }[];
