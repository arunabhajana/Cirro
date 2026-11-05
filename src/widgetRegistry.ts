import { CloudOff, Clock3, Grid2X2, HardDrive, Star, Trash2, Users } from 'lucide-react';
export const widgetRegistry = [
  { key: 'storage', name: 'Storage overview', description: 'Used and available space across your drives.', icon: HardDrive },
  { key: 'composition', name: 'File composition', description: 'See storage usage by file type.', icon: Grid2X2 },
  { key: 'recent', name: 'Recent files', description: 'Open your four most recent files.', icon: Clock3 },
  { key: 'sync', name: 'Sync status', description: 'Connection and sync status for your accounts.', icon: CloudOff },
  { key: 'starred', name: 'Starred files', description: 'Quick access to files you have starred.', icon: Star },
  { key: 'accounts', name: 'Account storage', description: 'Available space in each Google account.', icon: Users },
  { key: 'trash', name: 'Trash overview', description: 'Review and restore deleted items.', icon: Trash2 },
] as const;
export type Widgets = Record<typeof widgetRegistry[number]['key'], boolean>;
export const defaultWidgets: Widgets = { storage: true, composition: true, recent: true, sync: false, starred: false, accounts: false, trash: false };
