import { useEffect, useState } from 'react';
import { ChevronRight, CloudOff, FileText, Star, Trash2, Wifi, WifiOff } from 'lucide-react';
import { accounts, type DriveFile } from './data';
import type { Widgets } from './widgetRegistry';
import { useAuth } from './auth';
import {driveState} from './drive';
export default function ExtraWidgets({ order, widgets, files, scope, onOpen, onAccounts, onStarred, onTrash, onAccount }: { order:string[]; widgets: Widgets; files: DriveFile[]; scope: string; onOpen: (file: DriveFile) => void; onAccounts: () => void; onStarred: () => void; onTrash: () => void; onAccount: (scope: string) => void }) {
  const { user } = useAuth();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  const selected = files.filter(file => scope === 'all' || file.account === scope);
  const starred = selected.filter(file => file.starred && !file.trashed && file.type !== 'folder');
  const trashed = selected.filter(file => file.trashed);
  return <>
    {widgets.sync && <section style={{order:order.indexOf('sync')}} className="widget sync-widget"><div className="section-title"><h3>Sync status</h3></div><div className="sync-state"><CloudOff size={23}/><div><strong>{driveState.syncing ? 'Syncing…' : driveState.error ? 'Sync needs attention' : 'Connected to Google Drive'}</strong><p>{driveState.error || (driveState.lastSync ? `Last synced ${driveState.lastSync}` : `Signed in as ${user?.name}`)}</p></div></div><div className="network-state">{online ? <Wifi size={14}/> : <WifiOff size={14}/>}Device {online ? 'online' : 'offline'}</div><button className="widget-button" onClick={onAccounts}>Manage accounts<ChevronRight size={14}/></button></section>}
    {widgets.starred && <section style={{order:order.indexOf('starred')}} className="widget"><div className="section-title"><h3>Starred files</h3><button className="text-button" onClick={onStarred}>View all<ChevronRight size={13}/></button></div>{starred.slice(0, 3).map(file => <button className="small-widget-file" key={file.id} onClick={() => onOpen(file)}><Star size={15}/><span>{file.name}</span><ChevronRight size={13}/></button>)}{!starred.length && <p className="widget-empty">Star files to show them here.</p>}</section>}
    {widgets.accounts && <section style={{order:order.indexOf('accounts')}} className="widget"><div className="section-title"><h3>Drive storage</h3><span className="muted">Available</span></div>{accounts.filter(account => scope === 'all' || account.id === scope).map(account => <button className="account-storage-link" key={account.id} onClick={() => onAccount(account.id)}><span className={`account-dot ${account.id}`} style={{background:account.color}}/><span>{account.name}</span><strong>{(account.total - account.used).toFixed(1)} GB</strong><ChevronRight size={13}/></button>)}</section>}
    {widgets.trash && <section style={{order:order.indexOf('trash')}} className="widget"><div className="section-title"><h3>Trash</h3><button className="text-button" onClick={onTrash}>Review<ChevronRight size={13}/></button></div><div className="trash-widget-summary"><Trash2 size={25}/><div><strong>{trashed.length} {trashed.length === 1 ? 'item' : 'items'}</strong><p>Deleted items can be restored.</p></div></div></section>}
  </>;
}
