import TestAccessRequest from './TestAccessRequest';
import StorageUsageChart from './StorageUsageChart';
import {MAX_ACCOUNTS} from './accountLimits';
import type {SettingsSectionId} from './settingsCatalog';
import DestinationPicker,{rawId} from './DestinationPicker';
import SharingDialog from './SharingDialog';
import TransferDialog from './TransferDialog';
import TransferCentre,{TransferEvents,enqueueUploads} from './TransferCentre';
import OfflinePage from './OfflinePage';
import {useStartupLocation} from './startupLocation';
import {NotificationEvents,notifyQuietly} from './NotificationSettings';
import {FlowActivity} from './FlowSettings';
import {CloudActivity} from './CloudSettings';
import {removableShare,removedFromSharedView} from './sharedView';
import {trashPermission,trashPermissionMessage} from './filePermissions';
import {useDevicePreference} from './devicePreferences';
import ProgressBar from './ProgressBar';
import {offlineAction} from './offlineActions';
import {invoke} from './ipc';
import {beginOperation} from './operations';
import StorageWidget from './StorageWidget';
import {formatModified} from './formatting';
import Operations from './operations';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpDown, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Cloud, Code2, FileText, FileSpreadsheet, FileImage, FileVideo2, FileAudio2, Folder, Grid2X2, HardDrive, House, Image, Layers, LayoutList, LogOut, MoreHorizontal, Music2, Plus, Search, Settings, Copy, Scissors, ClipboardPaste, Pencil, PanelLeft, ArrowUp, ShieldCheck, SlidersHorizontal, Sparkles, Star, Sun, Trash2, Upload, Users, Video, X, Clock3, ExternalLink, Pin, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { accounts, initialFiles, type AccountId, type DriveFile } from './data';
import Titlebar from './Titlebar';
import QuickActions from './QuickActions';
import SettingsPage from './SettingsPage';
import FileGlyph, { describeFile } from './fileTypes';
import QuickLook from './QuickLook';
import FolderAppearance from './FolderAppearance';
import type { FolderStyle } from './folderStyles';

import { useAuth, AccountAvatar, ConnectedAccount } from './auth';
import SidebarCustomizer from './SidebarCustomizer';
import FileBrowser from './FileBrowser';
import ContextMenu, { type ContextState, type ContextAction } from './ContextMenu';
import ExtraWidgets from './ExtraWidgets';
import { defaultWidgets, widgetRegistry, type Widgets } from './widgetRegistry';
import { navigation, defaultSidebar, useWorkspaceNavigation, ancestors, isAvailable, type Page, type SidebarPreferences } from './workspace';
import { pasteFiles } from './fileOperations';
import { matchesFileSearch } from './search';
import { useAppearance } from './theme';
import { prepareUploads } from './uploads';
import {useDriveWorkspace,driveState,remoteContent,downloadFile} from './drive';
import {usePreference} from './preferences';

type Modal = 'customize' | 'upload' | 'new-folder' | 'accounts' | 'rename' | null;
function readSaved<T,>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function GoogleMark() { return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.25c1.9-1.75 2.97-4.33 2.97-7.35Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.42l-3.25-2.51c-.9.6-2.05.96-3.36.96-2.6 0-4.8-1.76-5.59-4.13H3.05v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.9a6 6 0 0 1 0-3.8V7.5H3.05a10 10 0 0 0 0 9l3.36-2.6Z"/><path fill="#EA4335" d="M12 5.97c1.47 0 2.79.51 3.82 1.51l2.86-2.86A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.5l3.36 2.6A5.99 5.99 0 0 1 12 5.97Z"/></svg>; }
function FileIcon({ file, large = false }: { file: DriveFile; large?: boolean }) { return <FileGlyph file={file} large={large}/>; }
function AccountTag({ id }: { id: AccountId }) { return <span className={`account-tag ${id}`} style={{color:accounts.find(account=>account.id===id)?.color}}><span/>{accounts.find(a => a.id === id)!.name}</span>; }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) { return <button type="button" className={`toggle ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange}><span/></button>; }

export default function App() {
  const { appearance, setAppearance,visual,setVisual } = useAppearance();
  useEffect(()=>{localStorage.removeItem('dd-files-v1');},[]);
  const auth = useAuth(); const user=auth.user;
  const {files,setFiles,sync}=useDriveWorkspace(user);
  const [,setDriveVersion]=useState(0);
  useEffect(()=>{const update=()=>setDriveVersion(v=>v+1);window.addEventListener('cirro-drive-state',update);return()=>window.removeEventListener('cirro-drive-state',update);},[]);
  const [settingsRequest,setSettingsRequest]=useState({section:'general' as SettingsSectionId,revision:0});
  const [sharing,setSharing]=useState<DriveFile|null>(null);
  const [transferDialog,setTransferDialog]=useState<{files:DriveFile[];mode:'copy'|'move'}|null>(null);
  const [destinationName,setDestinationName]=useState('My Drive');
  const [uploadPreparing,setUploadPreparing]=useState(false);
  const [uploadKind, setUploadKind] = useState<'files' | 'folder'>('files');
  const { current: { page, folder, scope }, go, back, forward, canBack, canForward } = useWorkspaceNavigation();
  useStartupLocation(user?.id,auth.users.map(account=>account.id),files,{page,folder,scope},go);
  useEffect(()=>{const open=()=>{go({page:'Offline files',folder:null});setQuery('');};window.addEventListener('cirro-open-offline',open);return()=>window.removeEventListener('cirro-open-offline',open);},[]);
  useEffect(()=>{const open=()=>go({page:'Transfers',folder:null});window.addEventListener('cirro-open-transfers',open);return()=>window.removeEventListener('cirro-open-transfers',open);},[]);
  const homeScope=scope==='all'?'unified':`account:${scope}`;
  const homeName=scope==='all'?'Unified Home':`${accounts.find(account=>account.id===scope)?.name||'Account'} Home`;
  const [sidebar,setSidebar]=useDevicePreference<SidebarPreferences>('device:sidebar',defaultSidebar,'sidebar');
  const [removedShares,setRemovedShares]=useDevicePreference<string[]>('device:removedSharedItems',[]);
  const [showRemovedShares,setShowRemovedShares]=useState(false);
  const [lastRemovedShares,setLastRemovedShares]=useState<string[]>([]);
  function removeFromSharedView(items:DriveFile[]){const ids=items.map(file=>file.id);setRemovedShares(old=>[...new Set([...old,...ids])]);setLastRemovedShares(ids);setMenu(null);setPreview(null);setNotice(`${items.length===1?items[0].name:items.length+' items'} removed from view in Cirro. Access and the original files are unchanged.`);}
  const sidebarOrder=[...sidebar.order,...navigation.map(item=>item.name).filter(name=>!sidebar.order.includes(name))];
  const [sidebarPins,setSidebarPins]=useDevicePreference<string[]>('device:sidebarPins',[],'sidebarPins');
  const [sidebarEditorOpen, setSidebarEditorOpen] = useState(false);
  const [sidebarEditorTab, setSidebarEditorTab] = useState<'navigation' | 'pins' | 'layout'>('navigation');
  const [context, setContext] = useState<ContextState | null>(null);
  const [clipboard, setClipboard] = useState<{ ids: string[]; mode: 'copy' | 'cut' } | null>(null);
  const [renameTarget, setRenameTarget] = useState<DriveFile | null>(null);


  const [pins,setPins]=useDevicePreference<string[]>(`home:${homeScope}:pins`,[],'pins',scope==='all'?undefined:scope);
  const [widgetOrder,setWidgetOrder]=useDevicePreference<string[]>(`home:${homeScope}:widgetOrder`,widgetRegistry.map(widget=>widget.key),'widgetOrder',scope==='all'?undefined:scope);
  const orderedWidgets=[...new Set([...widgetOrder,...widgetRegistry.map(widget=>widget.key)])].flatMap(key=>{const widget=widgetRegistry.find(item=>item.key===key);return widget?[widget]:[];});
  const moveWidget=(key:string,direction:number)=>{const order=orderedWidgets.map(widget=>widget.key);const index=order.indexOf(key as typeof order[number]);const target=index+direction;if(target<0||target>=order.length)return;[order[index],order[target]]=[order[target],order[index]];setWidgetOrder(order);};
  const [widgets,setWidgets]=useDevicePreference<Widgets>(`home:${homeScope}:widgets`,defaultWidgets,'widgets',scope==='all'?undefined:scope);
  const [recentIds,setRecentIds]=usePreference<string[]>(user?.id,'recent',[]);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [sort, setSort] = useState('modified');
  const [preview, setPreview] = useState<DriveFile | null>(null);
  useEffect(()=>()=>{if(preview?.remote && preview.url)URL.revokeObjectURL(preview.url);},[preview?.url]);
  const [menu, setMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(()=>{const handler=(event:Event)=>setNotice(String((event as CustomEvent).detail));window.addEventListener('cirro-account-error',handler);return()=>window.removeEventListener('cirro-account-error',handler);},[]);
  const [newName, setNewName] = useState('');
  const [folderColor,setFolderColor] = useState('blue');
  const [folderStyle,setFolderStyle] = useState<FolderStyle>('default');
  const [uploadAccount, setUploadAccount] = useState<AccountId>(user?.id||'');
  const [pendingUploads, setPendingUploads] = useState<File[]>([]);
  const [uploadFolder, setUploadFolder] = useState('root');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const contextOrigin = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dialogOpen = modal !== null || preview !== null || sidebarEditorOpen;
  useEffect(() => {
    if (!dialogOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([hidden]):not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => (dialog.querySelector<HTMLElement>('input:not([hidden])') || controls()[0])?.focus());
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', trapFocus); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [dialogOpen]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus(); } if (e.key === 'Escape') { setModal(null); setPreview(null); setSidebarEditorOpen(false); setContext(null); setMenu(null); if (accountMenuRef.current?.querySelector('.account-popover')) accountMenuRef.current.querySelector<HTMLButtonElement>('.account-trigger')?.focus(); setAccountMenuOpen(false); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  useEffect(() => {
    if (!accountMenuOpen) return;
    accountMenuRef.current?.querySelector<HTMLButtonElement>('[data-account-action]')?.focus();
    const close = (event: PointerEvent) => { if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [accountMenuOpen]);
  useEffect(() => { setContext(null); }, [page, folder, scope]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); back(); setQuery(''); } if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); forward(); setQuery(''); } if (event.altKey && event.key === 'ArrowUp' && folder) { event.preventDefault(); go({ folder: files.find(file => file.id === folder)?.parent || null }); setQuery(''); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [folder, files]);
  useEffect(() => {
    // Each authenticated session starts on Home, including restoring a saved session.
    go({ page: 'Home', folder: null, scope: 'all' });
    setQuery(''); setModal(null); setPreview(null); setMenu(null); setContext(null);
    setSidebarEditorOpen(false); setAccountMenuOpen(false); setNotice(''); setClipboard(null);
    if (location.hash === '#login') history.replaceState(null, '', location.pathname + location.search);
  }, [user?.id]);
  function openUpload(kind: 'files' | 'folder' = 'files') { setUploadKind(kind); const destination = files.find(file => file.id === folder); setPendingUploads([]); setUploadAccount(destination?.account || (scope==='all'?user?.id||'':scope)); setUploadFolder(destination?.id || 'root'); setDestinationName(destination?.name || 'My Drive'); setModal('upload'); }
  function openNewFolder() { setUploadFolder(files.find(file=>file.id===folder)?.id||'root');setDestinationName(files.find(file=>file.id===folder)?.name||'My Drive'); setNewName(''); setFolderColor('blue'); setFolderStyle('default'); setUploadAccount(files.find(file => file.id === folder)?.account || (scope==='all'?user?.id||'':scope)); setModal('new-folder'); }
  function selectAccount(next: string) { go({ page: 'Home', scope: next, folder: null }); setModal(null); setPreview(null); setQuery(''); setAccountMenuOpen(false); accountMenuRef.current?.querySelector<HTMLButtonElement>('.account-trigger')?.focus(); }
  function openSettings(section:SettingsSectionId='general'){setSettingsRequest(old=>({section,revision:old.revision+1}));navigate('Settings');}
  function navigate(next: Page) { go({ page: next, folder: null }); setQuery(''); setMenu(null); }
  async function openFile(file: DriveFile) { if(removedFromSharedView(file,files,removedShares))setRemovedShares(old=>old.filter(id=>id!==file.id&&!ancestors(file.parent||null,files).some(parent=>parent.id===id)));setMenu(null); if (file.type === 'folder') { go({ page: 'My files', folder: file.id, scope: scope === 'all' ? 'all' : file.account }); setQuery(''); } else {  setRecentIds(old => [file.id, ...old.filter(id => id !== file.id)].slice(0, 20)); setPreview(file.remote?{...file,previewLoading:true}:file); if(file.remote){try{const content=await remoteContent(file);setPreview(current=>current?.id===file.id?{...file,url:content.url,previewLoading:false,previewOffline:content.offline,previewStale:content.stale,mimeType:content.mime,name:content.mime==='application/pdf'&&!file.name.endsWith('.pdf')?file.name+'.pdf':file.name}:current);}catch(error){setNotice(String(error));setPreview(current=>current?.id===file.id?{...file,previewLoading:false,previewError:String(error)}:current);}} } }
  function toggleStar(file: DriveFile) { setFiles(old => old.map(f => f.id === file.id ? { ...f, starred: !f.starred } : f)); setMenu(null); }
  async function trash(file: DriveFile) { if(removableShare(file,files)){removeFromSharedView([file]);return;} if(trashPermission(file)===false){setNotice(trashPermissionMessage(file,accounts.find(account=>account.id===file.account)?.email||file.account));return;} if(!await setFiles(old => old.map(f => f.id === file.id ? { ...f, trashed: !f.trashed } : f)))return; setMenu(null); setPreview(null); setNotice(file.trashed ? `${file.name} restored` : `${file.name} moved to Trash`); }
  const activeAccounts = accounts.filter(a => scope === 'all' || a.id === scope);
  const total = activeAccounts.reduce((n, a) => n + a.total, 0);
  const used = activeAccounts.reduce((n, a) => n + a.used, 0);
  const live = files.filter(f => (!f.remote||f.inMyDrive===true)&&isAvailable(f, files) && (scope === 'all' || f.account === scope));
  const composition=[{name:'Photos',kinds:['image'],color:'pink'},{name:'Videos',kinds:['video'],color:'purple'},{name:'Documents',kinds:['doc','pdf','sheet','slides','text'],color:'blue'},{name:'Other files',kinds:[],color:'gray'}].map(category=>({...category,size:live.filter(f=>f.type!=='folder'&&(category.kinds.length?category.kinds.includes(f.type):!['image','video','doc','pdf','sheet','slides','text'].includes(f.type))).reduce((n,f)=>{const unit=['B','KB','MB','GB','TB'].indexOf(f.size.split(' ').pop()||'B');return n+(parseFloat(f.size)||0)*1000**Math.max(0,unit);},0)/1e9}));
  const compositionTotal=composition.reduce((n,item)=>n+item.size,0);
  const recentFiles = [...recentIds.map(id => live.find(f => f.id === id)).filter((f): f is DriveFile => Boolean(f) && f?.type !== 'folder'), ...live.filter(f => f.type !== 'folder' && !recentIds.includes(f.id))].slice(0, 4);
  const homeFolders = pins.map(id => live.find(file => file.id === id)).filter((file): file is DriveFile => Boolean(file));
  let shownFiles = files.filter(f => (scope === 'all' || f.account === scope) && (page==='Trash'||page==='Shared with me'||folder||!f.remote||f.inMyDrive===true) && (page === 'Trash' ? f.trashed : isAvailable(f, files)));
  if (query) shownFiles = shownFiles.filter(f => matchesFileSearch(f, query, files));
  else if (page === 'Home' || page === 'Recent') shownFiles = shownFiles.filter(f => f.type !== 'folder' && (page !== 'Recent' || recentIds.includes(f.id)));
  else if (page === 'Starred') shownFiles = shownFiles.filter(f => f.starred);
  else if (page === 'Shared with me') shownFiles = shownFiles.filter(f => f.shared||ancestors(f.parent||null,files).some(parent=>parent.shared));
  else if (page === 'My files') shownFiles = shownFiles.filter(f => folder ? f.parent === folder : (!f.remote||f.inMyDrive===true)&&!f.parent);
  if(page==='Shared with me'&&!query&&!showRemovedShares)shownFiles=shownFiles.filter(file=>!removedFromSharedView(file,files,removedShares));
  if (sort === 'name') shownFiles = [...shownFiles].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'account') shownFiles = [...shownFiles].sort((a, b) => a.account.localeCompare(b.account));
  const folderData = files.find(f => f.id === folder);
  const hasWidgets = Object.values(widgets).some(Boolean);
  async function createFolder() {
    const name = newName.trim(); if (!name) return;
    const parent = rawId(uploadFolder)==='root'?undefined:(files.find(file=>file.account===uploadAccount&&rawId(file.id)===rawId(uploadFolder))?.id||`${uploadAccount}::${rawId(uploadFolder)}`);
    if (/[\\/]/.test(name)) { setNotice('Folder names cannot contain slashes.'); return; }
    if (files.some(file => !file.trashed && file.account === uploadAccount && file.parent === parent && file.name.toLowerCase() === name.toLowerCase())) { setNotice('A folder or file with this name already exists here.'); return; }
    if(!await setFiles(old => [{ id: crypto.randomUUID(), name, type: 'folder', account: uploadAccount, parent, size: '0 B', modified: 'Just now', color: folderColor, folderStyle, items: 0 }, ...old])) return;
    setNewName(''); setModal(null); setNotice(`${name} created`);
  }
  const [conflictPrompt,setConflictPrompt]=useState<((choice:'keep'|'replace'|null)=>void)|null>(null);
  async function addUploads() {
    if (!pendingUploads.length) return;
    const account = accounts.find(account => account.id === uploadAccount)!;
    if (account.total > 0 && pendingUploads.reduce((bytes, file) => bytes + file.size, 0) / 1e9 > account.total - account.used) { setNotice('These files exceed the available storage. Choose another drive.'); return; }
    const policy=await invoke<{conflict:'keep'|'replace'|'ask'}>('storage_settings',{value:null}).catch(error=>{setNotice(String(error));return null;});if(!policy)return;
    let choice=policy.conflict;
    if(choice==='ask'||choice==='replace'){const selected=await new Promise<'keep'|'replace'|null>(resolve=>setConflictPrompt(()=>resolve));setConflictPrompt(null);if(!selected)return;choice=selected;}
    setUploadPreparing(true);const operation=beginOperation('Preparing durable upload');
    try{await enqueueUploads(pendingUploads,uploadAccount,rawId(uploadFolder),choice);setNotice('Upload queued. You can follow progress in Transfers.');}catch(error){setNotice(String(error));return;}finally{operation.finish();setUploadPreparing(false);}
    setPendingUploads([]); setModal(null);
  }
  const quickActions = <QuickActions onUpload={openUpload} onNewFolder={openNewFolder}/>;

  function toggleSidebarPin(file: DriveFile) { setSidebarPins(old => old.includes(file.id) ? old.filter(id => id !== file.id) : [...old, file.id]); }
  function rename(file: DriveFile) { setRenameTarget(file); setNewName(file.name); setModal('rename'); }
  async function saveRename() {
    const name = newName.trim(); if (!renameTarget || !name) return;
    if (/[\\/]/.test(name)) { setNotice('Names cannot contain slashes.'); return; }
    if (files.some(file => file.id !== renameTarget.id && !file.trashed && file.parent === renameTarget.parent && file.account === renameTarget.account && file.name.toLowerCase() === name.toLowerCase())) { setNotice('An item with this name already exists in this folder.'); return; }
    if(!await setFiles(old => old.map(file => file.id === renameTarget.id ? { ...file, name, modified: 'Just now' } : file))) return;
    setModal(null); setNotice('Name updated');
  }
  function copyItems(items: DriveFile[], cut: boolean) { setClipboard({ ids: items.map(file => file.id), mode: cut ? 'cut' : 'copy' }); setNotice(`${items.length} ${items.length === 1 ? 'item' : 'items'} ready to ${cut ? 'move' : 'copy'}. Open a destination and paste.`); }
  async function pasteInto(destination: string | null = folder) {
    if (!clipboard) return;
    const targetAccount = files.find(file => file.id === destination)?.account || (scope==='all'?user?.id||'':scope);
    try { const next = pasteFiles(files, clipboard.ids, clipboard.mode, destination, targetAccount); if(!await setFiles(next))return; if (clipboard.mode === 'cut') setClipboard(null); setNotice('Items pasted'); } catch (error) { setNotice((error as Error).message); }
  }
  async function bulk(action: 'star' | 'pin' | 'trash', items: DriveFile[]) {
    const ids = new Set(items.map(file => file.id));
    if (action === 'pin') { setSidebarPins(old => [...new Set([...old, ...ids])]); setNotice('Pinned to sidebar'); }
    else if (action === 'star') { const value = items.some(file => !file.starred); setFiles(old => old.map(file => ids.has(file.id) ? { ...file, starred: value } : file)); }
    else { const shared=items.filter(file=>removableShare(file,files));if(shared.length===items.length){removeFromSharedView(shared);return;}const remaining=items.filter(file=>!shared.includes(file));const denied=remaining.find(file=>trashPermission(file)===false);if(denied){setNotice(trashPermissionMessage(denied,accounts.find(account=>account.id===denied.account)?.email||denied.account));return;}for(const file of shared)ids.delete(file.id); const restore = remaining.every(file => file.trashed); if(!await setFiles(old => old.map(file => ids.has(file.id) ? { ...file, trashed: !restore } : file)))return; if(shared.length)removeFromSharedView(shared);setNotice(restore ? 'Items restored' : shared.length?'Own files moved to Trash; shared items removed from view in Cirro.':'Items moved to Trash'); }
  }
  function openSidebar(tab: 'navigation' | 'pins' | 'layout' = 'navigation') { setSidebarEditorTab(tab); setSidebarEditorOpen(true); }
  function closeContext() { setContext(null); if (contextOrigin.current?.isConnected) contextOrigin.current.focus({ preventScroll: true }); }
  function showContext(event: MouseEvent, file?: DriveFile, selection?: DriveFile[], source: 'sidebar' | 'workspace' = 'workspace') {
    event.preventDefault(); event.stopPropagation(); contextOrigin.current = event.currentTarget as HTMLElement; setMenu(null);
    const items = selection?.length ? selection : file ? [file] : [];
    let actions: ContextAction[];
    if (items.length > 1) actions = [
      { label: 'Copy items', icon: Copy, shortcut: 'Ctrl C', run: () => copyItems(items, false), disabled: items.some(file => file.trashed) },
      { label: 'Cut items', icon: Scissors, shortcut: 'Ctrl X', run: () => copyItems(items, true), disabled: items.some(file => file.trashed) },
      { label: 'Pin to sidebar', icon: Pin, run: () => bulk('pin', items), divider: true },
      { label: 'Pin to Home', icon: House, run: () => setPins(old => [...new Set([...old, ...items.map(file => file.id)])]), disabled: items.some(file => file.trashed) },
      { label: 'Copy to…', icon: Copy, run: () => setTransferDialog({files:items,mode:'copy'}) },
      { label: 'Move to…', icon: Folder, run: () => setTransferDialog({files:items,mode:'move'}) },
      { label: 'Star items', icon: Star, run: () => bulk('star', items) },
      { label: items.every(file => file.trashed) ? 'Restore items' : items.every(file=>removableShare(file,files))?'Remove from view':'Move to trash / remove from view', disabled:items.some(file=>!removableShare(file,files)&&trashPermission(file)===false),disabledReason:items.some(file=>!removableShare(file,files)&&trashPermission(file)===false)?'One or more selected items cannot be changed by their connected account.':undefined, icon: Trash2, run: () => bulk('trash', items), danger: !items.every(file => file.trashed), divider: true },
    ];
    else if (file) actions = file.trashed ? [{ label: 'Restore', disabled:file.canUntrash===false,disabledReason:file.canUntrash===false?trashPermissionMessage(file,accounts.find(account=>account.id===file.account)?.email||file.account):undefined, icon: RefreshCw, run: () => trash(file) }] : [
      { label: file.type === 'folder' ? 'Open folder' : 'Open Quick Look', icon: file.type === 'folder' ? Folder : FileText, shortcut: 'Enter', run: () => openFile(file) },
      ...(file.type !== 'folder' ? [{ label: 'Show in folder', icon: ExternalLink, run: () => { go({ page: 'My files', folder: file.parent || null, scope: file.account }); setQuery(''); } }] : []),
      { label: 'Share / manage access', icon: Users, run: () => setSharing(file), divider: true },
      { label: 'Copy to…', icon: Copy, run: () => setTransferDialog({files:[file],mode:'copy'}) },
      { label: 'Move to…', icon: Folder, run: () => setTransferDialog({files:[file],mode:'move'}), disabled:file.canTrash===false },
      { label: 'Rename', icon: Pencil, shortcut: 'F2', run: () => rename(file), divider: true },
      { label: 'Copy', icon: Copy, shortcut: 'Ctrl C', run: () => copyItems([file], false) },
      { label: 'Cut', icon: Scissors, shortcut: 'Ctrl X', run: () => copyItems([file], true) },
      ...(file.type === 'folder' ? [{ label: 'Paste into folder', icon: ClipboardPaste, disabled: !clipboard, run: () => pasteInto(file.id) }] : []),
      { label: sidebarPins.includes(file.id) ? 'Unpin from sidebar' : 'Pin to sidebar', icon: PanelLeft, run: () => toggleSidebarPin(file), divider: true },
      { label: pins.includes(file.id) ? 'Unpin from Home' : 'Pin to Home', icon: House, run: () => setPins(old => old.includes(file.id) ? old.filter(id => id !== file.id) : [...old, file.id]) },
      { label: file.starred ? 'Remove star' : 'Add star', icon: Star, run: () => toggleStar(file) },
      ...(file.remote ? [{label:file.offline?'Remove offline copy':'Make available offline',icon:ArrowDownToLine,run:()=>{const operation=beginOperation(file.offline?'Removing offline copy':`Saving ${file.name} offline`);void offlineAction(file,operation).then(result=>{window.dispatchEvent(new Event('cirro-offline'));setNotice(file.offline?'Offline copy removed':file.type==='folder'?`Folder saved offline · ${result?.files||0} files${result?.onlineLinks?` · ${result.onlineLinks} links need internet`:''}`:'File available offline');}).catch(error=>{setNotice(String(error));notifyQuietly('errors','Offline download needs attention',String(error));}).finally(()=>operation.finish());}},...(file.offline?[{label:'Open offline copy',icon:ExternalLink,run:()=>{void invoke('offline_open',{id:file.id}).catch(error=>setNotice(String(error)));}}]:[])] : []),
      ...(file.type !== 'folder' ? [{ label: 'Download', icon: ArrowDownToLine, disabled: !file.url && !file.remote, run: () => { void downloadFile(file).catch(error=>{setNotice(String(error));notifyQuietly('errors','Download needs attention',String(error));}); } }] : []),
      { label: removableShare(file,files)?(removedFromSharedView(file,files,removedShares)?'Restore to view':'Remove from view'):'Move to trash', disabled:!removableShare(file,files)&&file.canTrash===false,disabledReason:!removableShare(file,files)&&file.canTrash===false?trashPermissionMessage(file,accounts.find(account=>account.id===file.account)?.email||file.account):undefined, icon: Trash2, shortcut: 'Delete', run: () => {if(removableShare(file,files)&&removedFromSharedView(file,files,removedShares)){setRemovedShares(old=>old.filter(id=>id!==file.id&&!ancestors(file.parent||null,files).some(parent=>parent.id===id)));setNotice('Restored to Shared with me in Cirro.');}else void trash(file);}, danger: !removableShare(file,files), divider: true },
    ];
    else actions = page === 'Settings' && source !== 'sidebar' ? [{ label: 'Search settings', icon: Search, run: () => document.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')?.focus() }, { label: 'Customize sidebar', icon: PanelLeft, run: () => openSidebar() }, { label: 'Manage accounts', icon: Users, run: () => openSettings('accounts') }] : source === 'sidebar' ? [{ label: 'Customize sidebar', icon: SlidersHorizontal, run: () => openSidebar() }, { label: 'Manage pinned items', icon: Pin, run: () => openSidebar('pins') }] : [
      { label: 'New folder', icon: Folder, run: openNewFolder, disabled: page === 'Trash' },
      { label: 'Upload files', icon: Upload, run: () => openUpload('files'), disabled: page === 'Trash' },
      { label: 'Upload folder', icon: Folder, run: () => openUpload('folder'), disabled: page === 'Trash' },
      { label: 'Paste', icon: ClipboardPaste, shortcut: 'Ctrl V', run: () => pasteInto(), disabled: !clipboard || page === 'Trash', divider: true },
      ...(page === 'Home' ? [{ label: 'Customize Home', icon: SlidersHorizontal, run: () => setModal('customize'), divider: true }] : []),
    ];
    setContext({ x: event.clientX, y: event.clientY, label: items.length > 1 ? `${items.length} items` : file?.name || (source === 'sidebar' ? 'Sidebar' : folderData?.name || page), actions });
  }
  const fileTable = (items: DriveFile[], _compact?: boolean) => <div className="storage-file-list">{items.map(file => <div key={file.id} onContextMenu={event => showContext(event, file)}><button onClick={() => openFile(file)}><FileIcon file={file}/><span>{file.name}</span><small>{file.size}</small></button><button className="icon-button" aria-label={`Actions for ${file.name}`} onClick={event => showContext(event, file)}><MoreHorizontal size={18}/></button></div>)}</div>;

  if (auth.phase === 'loading') return <div className="login-screen"><Titlebar/><div className="auth-loading" role="status"><RefreshCw className="auth-spinner" size={20}/>Checking your Google session…</div></div>;
  if (!user) return <div className="login-screen"><Titlebar/><div className="login-layout"><section className="login-copy"><span className="eyebrow"><span className="live-dot"/> WELCOME TO CIRRO</span><h1>Make room<br/>for <span>what matters.</span></h1><p>Sign in with your Google account<br/>to open your workspace.</p><button className="google-button" disabled={!auth.desktop || auth.phase === 'signing-in'} onClick={() => void auth.signIn()}><GoogleMark/>{auth.phase === 'signing-in' ? 'Waiting for Google…' : 'Continue with Google'}{auth.phase === 'signing-in' ? <RefreshCw className="auth-spinner" size={18}/> : <ArrowRight size={18}/>}</button><div className="login-assurance"><ShieldCheck size={15}/>Connect your Google profile and allow access to manage your Drive.</div>
    <div className="auth-feedback">
      {!auth.desktop ? <p>Open the Cirro desktop app to sign in with Google.</p> : auth.phase === 'signing-in' ? <div role="status"><p>Finish signing in in your browser. Cirro will open Home automatically.</p><button className="text-button" onClick={() => void auth.cancel()}>Cancel sign-in</button></div> : !auth.configured && !auth.error ? <p>Google sign-in is unavailable in this installation.</p> : null}
      {auth.error && <div className="auth-error" role="alert"><p>{auth.error}</p><button className="text-button" disabled={auth.phase !== 'ready'} onClick={() => void auth.retry()}>Retry saved session</button></div>}

    </div><div className="login-test-access"><TestAccessRequest variant="login"/></div></section><section className="login-illustration" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="floating-chip chip-one"><CheckCheck size={17}/>Everything in its place</div><div className="login-mini-window"><div className="mini-top"><span/><span/><span/><b>Cirro</b></div><div className="mini-content"><span className="eyebrow">YOUR WORKSPACE</span><h2>Your space, simplified. <Sun size={25}/></h2><div className="mini-folders">{initialFiles.slice(0, 3).map(f => <div key={f.id}><FileIcon file={f} large/><b>{f.name}</b><small>{f.items} items</small></div>)}</div><div className="mini-storage"><Cloud size={24}/><div><b>A home for your files</b><small>Choose the folders and widgets you see</small></div><span className="check-badge"><Check size={14}/></span></div></div></div><div className="floating-chip chip-two"><GoogleMark/><span>Sign in securely with Google</span><ShieldCheck size={14}/></div></section></div><footer className="login-footer"><span>CIRRO</span><span>Your Google accounts. One workspace.</span></footer></div>;

  return <div className={`desktop-shell ${sidebar.wide ? 'sidebar-wide' : ''}`} onContextMenu={event => { if (!(event.target as HTMLElement).closest('input, textarea, [role="dialog"], .titlebar')) showContext(event); }} onClick={() => { if (menu) setMenu(null); }}>
    <Titlebar search={<div className="global-search"><Search size={18}/><input ref={searchRef} aria-label="Search your drives" title="Search names, accounts, and folder paths. Filters: type:pdf, account:work, in:Projects." value={query} onChange={e => {setQuery(e.target.value);if(e.target.value)go({scope:"all",folder:null});}}/>{query ? <button aria-label="Clear search" onClick={() => setQuery('')}><X size={15}/></button> : <kbd>Ctrl K</kbd>}</div>}/>
    <aside className={`sidebar ${sidebar.compact ? 'compact' : ''}`} onContextMenu={event => showContext(event, undefined, undefined, 'sidebar')}><div className="sidebar-scroll">
      <div className="sidebar-section-heading library-heading"><span>LIBRARY</span><button className="icon-button" aria-label="Customize sidebar" title="Customize sidebar" onClick={() => openSidebar()}><SlidersHorizontal size={13}/></button></div>
      <nav aria-label="Main navigation">{sidebarOrder.filter(name => !sidebar.hidden.includes(name)).map(name => navigation.find(item => item.name === name)!).filter(Boolean).map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${page === name && !query ? 'active' : ''}`} title={name} aria-current={page === name && !query ? 'page' : undefined} onClick={() => navigate(name)}><Icon size={20}/><span>{name === 'My files' ? 'All files' : name}</span>{name === 'Home' && <span className="nav-active-dot"/>}</button>)}</nav>
      {sidebar.showPins && <section className="sidebar-pins"><div className="sidebar-section-heading"><span>PINNED</span><button className="icon-button" aria-label="Customize pinned items" title="Customize pinned items" onClick={() => openSidebar('pins')}><SlidersHorizontal size={13}/></button></div>{sidebarPins.map(id => files.find(file => file.id === id)).filter((file): file is DriveFile => Boolean(file) && isAvailable(file!, files)).map(file => <button key={file.id} className={`sidebar-pin ${folder === file.id ? 'active' : ''}`} title={file.name} onClick={() => openFile(file)} onContextMenu={event => showContext(event, file, undefined, 'sidebar')}><FileIcon file={file}/><span>{file.name}</span><span className={`account-dot ${file.account}`} style={{background:accounts.find(account=>account.id===file.account)?.color}}/></button>)}{!sidebarPins.length && <p className="sidebar-pin-hint">Right-click an item to pin it here.</p>}</section>}
      </div>
      <div className="sidebar-bottom">
        <div className="account-switcher" ref={accountMenuRef} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); contextOrigin.current = event.currentTarget; setContext({ x: event.clientX, y: event.clientY, label: 'Google account', actions: [{ label: 'Account details', icon: Users, run: () => openSettings('accounts') }, { label: 'Sign out', icon: LogOut, run: () => void auth.signOut(), divider: true }] }); }}>
          <button className={`account-trigger ${accountMenuOpen ? 'open' : ''}`} aria-label={`Google account: ${user.name}`} aria-expanded={accountMenuOpen} aria-controls="account-popover" onClick={() => setAccountMenuOpen(!accountMenuOpen)}>
            {scope==='all'?<span className="google-account-avatar"><Layers size={20}/></span>:<AccountAvatar user={auth.users.find(account=>account.id===scope)||user}/>}<span className="account-trigger-copy"><strong>{scope==='all'?'All accounts':accounts.find(a=>a.id===scope)?.name||user.name}</strong><small>{scope==='all'?`${auth.users.length} connected accounts`:accounts.find(account=>account.id===scope)?.email||user.email}</small></span><ChevronDown size={14} className="account-trigger-chevron"/>
          </button>
          {accountMenuOpen && <div className="account-popover" id="account-popover" role="region" aria-label="Google account">
            <div className="account-popover-heading"><h3>Accounts</h3><span>{auth.users.length} connected</span></div><button className="connect-account-option" aria-pressed={scope==='all'} onClick={()=>selectAccount('all')}><Layers size={17}/>All accounts · Unified view</button>{auth.users.map(account=><button className="connect-account-option" key={account.id} aria-pressed={scope===account.id} onClick={()=>{selectAccount(account.id);}}><AccountAvatar user={account}/><span className="dropdown-account-dot" style={{background:accounts.find(item=>item.id===account.id)?.color}}/><span className="picker-account-identity" style={{borderColor:accounts.find(a=>a.id===account.id)?.color}}><strong>{accounts.find(a=>a.id===account.id)?.name||account.name}</strong><small>{account.email}</small></span>{scope===account.id&&<Check size={15}/>}</button>)}<button className="connect-account-option" disabled={auth.phase==='signing-in'||auth.users.length>=MAX_ACCOUNTS} onClick={()=>void auth.signIn()}><Plus size={17}/>{auth.users.length>=MAX_ACCOUNTS?'5-account limit reached':'Add Google account'}</button><div className="account-popover-divider"/>
            <button className="connect-account-option" data-account-action onClick={() => { setAccountMenuOpen(false); openSettings('accounts'); }}><Users size={17}/>Account details</button>
            <button className="connect-account-option" disabled={auth.phase === 'signing-out'} onClick={() => void auth.signOut()}><LogOut size={17}/>{auth.phase === 'signing-out' ? 'Signing out…' : 'Sign out'}</button>
          </div>}
        </div>
        <button className={`sidebar-settings ${page === 'Settings' ? 'active' : ''}`} aria-label="Settings" title="Settings" onClick={() => openSettings()}><Settings size={20} strokeWidth={1.7}/></button>
      </div>
    </aside>
    <div className="workspace">
      <main className="main-content"><div className="drive-sync-toolbar"><span role="status">{driveState.mutating ? 'Applying changes to Google Drive…' : driveState.syncing ? 'Syncing Google Drive…' : driveState.lastSync ? `Synced at ${driveState.lastSync}` : 'Google Drive'}</span><button className="text-button" disabled={driveState.syncing} onClick={()=>void sync()}><RefreshCw size={14}/>Sync now</button></div>{driveState.error && <div className="auth-banner" role="alert"><span>{driveState.error}</span><button className="text-button" onClick={()=>void sync()}>Refresh Drive</button></div>}{auth.error && <div className="auth-banner" role="alert"><CircleHelp size={18}/><span>{auth.error}</span></div>}
      {page === 'Transfers' && !query ? <TransferCentre/> : page === 'Offline files' && !query ? <OfflinePage files={files} scope={scope} onPreview={file=>void openFile(file)}/> : page === 'Settings' && !query ? <SettingsPage key={settingsRequest.revision} initialSection={settingsRequest.section} appearance={appearance} onAppearance={setAppearance} visual={visual} onVisualChange={setVisual} onSidebar={() => openSidebar()} onHome={() => setModal('customize')}/> : page === 'Storage' && !query ? <><div className="page-heading"><div><h1>Your storage</h1><p>Your Google account storage usage.</p></div><button className="secondary-button" onClick={() => openSettings('accounts')}><Users size={16}/>Account details</button></div><StorageUsageChart accounts={activeAccounts}/><section className="panel largest-files"><div className="section-title"><h3>Media files</h3><span className="muted">Videos and media in your drives</span></div><div className="storage-media-grid">{live.filter(f => ['video','image','audio'].includes(f.type)).map(file=><button className="storage-media-card" key={file.id} onContextMenu={event=>showContext(event,file)} onClick={()=>void openFile(file)} title={`Preview ${file.name}`}><FileIcon file={file} large/><strong>{file.name}</strong><small>{file.size}</small></button>)}</div></section></> : <>
      <div className="page-heading"><div>{page === 'Home' && !query ? <><h1>{homeName}</h1><p>{homeFolders.length} pinned {homeFolders.length === 1 ? 'item' : 'items'} <span className="heading-dot">·</span> {scope === 'all' ? 'All accounts' : accounts.find(a => a.id === scope)?.name||'Google Drive'}</p></> : <>{folder && !query && <button className="back-link" onClick={() => { go({ folder: folderData?.parent || null }); setQuery(''); }}><ArrowLeft size={14}/>My files</button>}<h1>{query ? 'Search results' : folderData?.name || (page === 'My files' ? 'All files' : page)}</h1><p>{query ? `Results for “${query}” across ${scope === 'all' ? 'all accounts' : scope + ' drive'}.` : page === 'My files' ? `${shownFiles.length} items · ${scope === 'all' ? 'All accounts' : (accounts.find(a => a.id === scope)?.name||'Google Drive')}` : page === 'Shared with me' ? 'Files and folders shared with your accounts.' : page === 'Starred' ? 'Files and folders you have starred.' : page === 'Trash' ? 'Deleted files stay here until you restore them.' : 'Recently opened files across your accounts.'}</p></>}</div><div className="heading-actions">{page === 'Home' && !query && <button className="secondary-button customize-button" onClick={() => setModal('customize')}><SlidersHorizontal size={16}/>Customize home</button>}{page !== 'Trash' && quickActions}</div></div>
      <div className={`home-layout ${!hasWidgets || page !== 'Home' || query ? 'no-widgets' : ''}`}><div className="primary-content">
      {page === 'Home' && !query && <section className="folder-section"><div className="section-title"><h2><Pin size={16}/>Pinned items<span className="count">{homeFolders.length}</span></h2><span className="section-hint">Right-click to pin</span></div><div className="folder-grid">{homeFolders.map(f => <div className={`folder-card ${f.color}`} key={f.id} onContextMenu={event => showContext(event, f)}><button className="folder-open" onClick={() => openFile(f)}><FileIcon file={f} large/><span className="folder-card-name">{f.name}</span><span className="folder-card-meta">{f.type === 'folder' ? `${f.items || 0} items` : describeFile(f).label}<span>·</span>{f.size}</span><AccountTag id={f.account}/></button><div className="folder-actions"><button className="icon-button" aria-label={`Actions for ${f.name}`} title="Folder actions" onClick={event => showContext(event, f)}><MoreHorizontal size={19}/></button></div>{f.shared && <span className="folder-shared"><Users size={13}/></span>}</div>)}</div>{!homeFolders.length && <div className="empty-state"><Pin size={28}/><h3>No pinned items</h3><p>Right-click a file or folder and choose Pin to Home.</p></div>}</section>}
      {page==='Shared with me'&&<div className="shared-view-controls"><span>Removing an item only hides it in Cirro on this device.</span><button className="text-button" aria-pressed={showRemovedShares} onClick={()=>setShowRemovedShares(old=>!old)}>{showRemovedShares?'Hide removed items':'Show removed items'}</button></div>}
      {(page !== 'Home' || query) && <FileBrowser items={shownFiles} files={files} page={page} folder={folder} scope={scope} query={query} canBack={canBack} canForward={canForward} back={() => { back(); setQuery(''); }} forward={() => { forward(); setQuery(''); }} up={() => { go({ folder: folderData?.parent || null }); setQuery(''); }} onFolder={id => { go({ page: 'My files', folder: id }); setQuery(''); }} onOpen={openFile} onContext={showContext} onBulk={bulk} onRename={rename} onCopy={copyItems} onPaste={() => pasteInto()} renderIcon={(file, large) => <FileIcon file={file} large={large}/>}/>}
      </div>{page === 'Home' && !query && hasWidgets && <aside className="widgets" aria-label="Home widgets"><div className="widgets-heading"><span>Overview</span><button className="text-button" onClick={() => setModal('customize')}><SlidersHorizontal size={14}/>Edit widgets</button></div>{widgets.storage && <StorageWidget scope={scope} order={orderedWidgets.findIndex(widget=>widget.key==='storage')} onManage={()=>navigate('Storage')}/>}
      {widgets.composition && <section style={{order:orderedWidgets.findIndex(widget=>widget.key==='composition')}} className="widget composition-widget"><div className="section-title"><h3>File composition</h3><span className="muted">GB</span></div><div className="composition-bar">{composition.map(item=><span key={item.name} style={{width:compositionTotal?`${item.size/compositionTotal*100}%`:'0%'}}/>)}</div><div className="composition-legend">{composition.map(x => <div key={x.name}><span className={`legend-dot ${x.color}`}/>{x.name}<strong>{x.size.toFixed(1)}</strong></div>)}</div></section>}
      {widgets.recent && <section style={{order:orderedWidgets.findIndex(widget=>widget.key==='recent')}} className="widget recent-widget" aria-label="Recent files"><div className="section-title"><h3>Recent files</h3><button className="text-button" onClick={() => navigate('Recent')}>View all<ChevronRight size={14}/></button></div><div className="recent-file-list">{recentFiles.map(file => <button className="recent-file" key={file.id} title={file.name} aria-label={`Open ${file.name}`} onClick={() => openFile(file)} onContextMenu={event => showContext(event, file)}><FileIcon file={file}/><span><strong>{file.name}</strong><small><span className={`account-dot ${file.account}`}/>{accounts.find(a => a.id === file.account)!.name}<span className="recent-separator">·</span>{formatModified(file.modified)}</small></span><ChevronRight size={14}/></button>)}</div>{!recentFiles.length && <p className="recent-empty">No recent files in this account.</p>}</section>}
      <ExtraWidgets order={orderedWidgets.map(widget=>widget.key)} widgets={widgets} files={files.filter(file => file.trashed || isAvailable(file, files))} scope={scope} onOpen={openFile} onAccounts={() => openSettings('accounts')} onStarred={() => navigate('Starred')} onTrash={() => navigate('Trash')} onAccount={selectAccount}/></aside>}</div>
      </>}
      </main><footer className="statusbar"><span><span className="live-dot"/>Google Drive<span className="status-divider"/>{auth.users.length} connected accounts<span className="status-divider"/>{live.length} items</span><span>{user.name}</span></footer>
    </div>
    {modal && <div className={`modal-overlay ${modal === 'customize' ? 'drawer-overlay' : ''}`} onClick={() => setModal(null)}><section role="dialog" aria-modal="true" aria-labelledby="modal-title" className={`modal ${modal === 'customize' ? 'customize-drawer' : ''}`} onClick={e => e.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">{modal === 'customize' ? 'A SPACE THAT FEELS LIKE YOU' : modal === 'upload' ? 'A PLACE FOR EVERYTHING' : modal === 'accounts' ? 'ACCOUNT & SIGN-IN' : 'KEEP THINGS ORGANIZED'}</span><h2 id="modal-title">{modal === 'customize' ? 'Customize home' : modal === 'upload' ? uploadKind === 'folder' ? 'Upload folder' : 'Upload files' : modal === 'accounts' ? 'Your Google account' : modal === 'rename' ? 'Rename' : 'New folder'}</h2></div><button className="icon-button close-modal" aria-label="Close dialog" onClick={() => setModal(null)}><X size={20}/></button></div>
      {modal === 'customize' ? <><p className="modal-description">Customize {homeName}. Changes save on this device for this view.</p><div className="customize-label"><h3>Pinned items</h3><span>{pins.length} selected</span></div><p className="small-description">Unpin items here. Add them using a file or folder’s context menu.</p><div className="folder-picker">{homeFolders.map(f => <button className={`folder-pick ${pins.includes(f.id) ? 'picked' : ''}`} aria-pressed={pins.includes(f.id)} key={f.id} onClick={() => setPins(old => old.includes(f.id) ? old.filter(id => id !== f.id) : [...old, f.id])}><FileIcon file={f}/><span><strong>{f.name}</strong><small>{accounts.find(a => a.id === f.account)!.name} · {f.items || 0} items</small></span><span className="checkbox"><X size={13}/></span></button>)}</div><div className="customize-label"><h3>Widgets</h3><span>{Object.values(widgets).filter(Boolean).length} active</span></div>{orderedWidgets.map((w,index) => <div className="widget-pick" key={w.key}><span className="widget-pick-icon"><w.icon size={19}/></span><div><strong>{w.name}</strong><small>{w.description}</small></div><div className="widget-arrange"><button className="icon-button" aria-label={`Move ${w.name} up`} disabled={index===0} onClick={()=>moveWidget(w.key,-1)}><ArrowUp size={15}/></button><button className="icon-button" aria-label={`Move ${w.name} down`} disabled={index===orderedWidgets.length-1} onClick={()=>moveWidget(w.key,1)}><ArrowDown size={15}/></button></div><Toggle checked={widgets[w.key]} label={`Show ${w.name}`} onChange={() => setWidgets(old => ({ ...old, [w.key]: !old[w.key] }))}/></div>)}<div className="drawer-footer"><span><CheckCheck size={15}/>Saved to this device</span><button className="primary-button" onClick={() => setModal(null)}>Done<Check size={16}/></button></div></> : modal === 'upload' ? <><p className="modal-description">Choose an account and folder. Upload progress appears in Transfers.</p><div className="upload-accounts">{accounts.map(a => <button key={a.id} className={`upload-account ${uploadAccount === a.id ? 'chosen' : ''}`} aria-pressed={uploadAccount === a.id} onClick={() => { setUploadAccount(a.id); setUploadFolder('root'); setDestinationName('My Drive'); }}><span className={`avatar ${a.id}`}><GoogleMark/></span><span className="upload-account-copy"><strong>{a.name}<small>{(a.total - a.used).toFixed(1)} GB free</small></strong><span>{a.email}</span><ProgressBar className="account-meter" value={a.used/(a.total||1)*100} label={`${a.name} storage used`} meter/></span><span className="radio">{uploadAccount === a.id && <span/>}</span></button>)}</div><DestinationPicker value={{account:uploadAccount,id:rawId(uploadFolder),name:destinationName}} onChange={value=>{setUploadAccount(value.account);setUploadFolder(value.id);setDestinationName(value.name);}} disabled={uploadPreparing}/><button className="dropzone" onClick={() => (uploadKind === 'folder' ? folderInput : fileInput).current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (uploadKind === 'folder') { setNotice('Choose a folder using the file picker to include its subfolders.'); } else setPendingUploads(Array.from(e.dataTransfer.files)); }}><span className="dropzone-icon"><Upload size={24}/></span><strong>{pendingUploads.length ? `${pendingUploads.length} ${pendingUploads.length === 1 ? 'file' : 'files'} ready to add` : uploadKind === 'folder' ? 'Choose a folder' : 'Drop files here'}</strong><span>{pendingUploads.length ? pendingUploads.map(f => f.name).join(', ') : uploadKind === 'folder' ? 'Click to browse · Files and subfolders included' : 'or click to browse your computer'}</span></button><input ref={fileInput} type="file" multiple hidden onChange={e => setPendingUploads(Array.from(e.target.files || []))}/><input ref={element => { folderInput.current = element; element?.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden aria-label="Select upload folder" onChange={e => setPendingUploads(Array.from(e.target.files || []))}/><div className="upload-note"><ShieldCheck size={15}/>Google Drive: files are uploaded to your connected Google Drive.</div><div className="modal-actions"><button className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={!pendingUploads.length || driveState.mutating || uploadPreparing} onClick={addUploads}><Upload size={16}/>Add {pendingUploads.length ? pendingUploads.length : ''} {pendingUploads.length === 1 ? 'file' : 'files'}</button></div></> : modal === 'rename' ? <form onSubmit={event => { event.preventDefault(); saveRename(); }}><p className="modal-description">Rename this {renameTarget?.type === 'folder' ? 'folder' : 'file'}.</p><label className="field-label">Name<input required maxLength={180} value={newName} onChange={event => setNewName(event.target.value)}/></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={!newName.trim() || driveState.mutating}>Save name</button></div></form> : modal === 'new-folder' ? <form className="create-folder-form" onSubmit={e => { e.preventDefault(); createFolder(); }}><p className="modal-description">Choose a name, destination, and appearance.</p><label className="field-label">Folder name<input required maxLength={100} value={newName} onChange={e => setNewName(e.target.value)}/></label><DestinationPicker value={{account:uploadAccount,id:rawId(uploadFolder),name:destinationName}} onChange={value=>{setUploadAccount(value.account);setUploadFolder(value.id);setDestinationName(value.name);}} label="Create folder in"/><FolderAppearance name={newName} color={folderColor} style={folderStyle} onColor={setFolderColor} onStyle={setFolderStyle}/><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={!newName.trim() || driveState.mutating}><Plus size={16}/>Create folder</button></div></form> : <><p className="modal-description">Your connected Google account.</p><ConnectedAccount/><p className="account-privacy"><ShieldCheck size={18}/>You are signed in with Google. Files, folders, and storage sync with Google Drive. Manage each connected account from the account switcher.</p></>}
    </section></div>}
    {conflictPrompt&&<div className="modal-overlay" style={{zIndex:500}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="upload-conflict-title"><h2 id="upload-conflict-title">Matching file names</h2><p className="modal-description">Choose what to do if a file name already exists in its destination. This applies to matching files in this upload. Folder uploads create new folders.</p><div className="modal-actions"><button className="secondary-button" onClick={()=>conflictPrompt(null)}>Cancel</button><button className="secondary-button" onClick={()=>conflictPrompt('replace')}>Replace matching files</button><button className="primary-button" onClick={()=>conflictPrompt('keep')}>Keep both</button></div></section></div>}
    {sharing&&<SharingDialog file={sharing} onClose={()=>setSharing(null)}/>}
    {transferDialog&&<TransferDialog files={transferDialog.files} mode={transferDialog.mode} onClose={()=>setTransferDialog(null)}/>}
    <TransferEvents/><NotificationEvents/><Operations/><FlowActivity/><CloudActivity/>{preview && <QuickLook key={preview.id} file={preview} files={files} onClose={() => setPreview(null)}/>}
    {sidebarEditorOpen && <SidebarCustomizer initialTab={sidebarEditorTab} preferences={{...sidebar,order:sidebarOrder}} onPreferences={setSidebar} pins={sidebarPins} onPins={setSidebarPins} files={files.filter(file => isAvailable(file, files))} onClose={() => setSidebarEditorOpen(false)}/>}
    {context && <ContextMenu value={context} onClose={closeContext}/>}
    {notice && <div className="toast" role="status"><CheckCheck size={19}/><span>{notice}</span>{lastRemovedShares.length>0&&notice.includes('removed from view')&&<button className="text-button" onClick={()=>{setRemovedShares(old=>old.filter(id=>!lastRemovedShares.includes(id)));setLastRemovedShares([]);setNotice("Restored to view in Cirro.");}}>Undo</button>}<button onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={16}/></button></div>}
  </div>;
}
