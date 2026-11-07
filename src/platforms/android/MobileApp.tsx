import {MAX_MOBILE_ACCOUNTS} from './auth/accountLimits';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpDown, ArrowUp, Bell, Check, ChevronRight, Cloud, CloudOff, FileImage, FileSpreadsheet, FileText, Folder, Grid2X2, HardDrive, House, LayoutList, MoreHorizontal, Plus, Search, Settings, SlidersHorizontal, Pin, FolderPlus, PieChart, RefreshCw, Moon, ExternalLink, Layers, Palette, FolderOpen, Eye, LogOut, Star, Trash2, Upload, Users, X, type LucideIcon } from 'lucide-react';
import type { DriveFile } from '../../data';
import { navigation, type Page } from '../../shared/navigation';
import { mockWorkspace } from './data/mockWorkspace';
import Sheet from './components/Sheet';
import FileRow from './components/FileRow';
import DestinationPicker from './components/DestinationPicker';
import SharingPanel from './components/SharingPanel';
import TransferPage from './transfers/TransferPage';
import {useTransfers} from './transfers/useTransfers';
import {pickPhoneFiles,type PickedFile} from './transfers/native';
import type {Destination,TransferSpec} from './transfers/operations';
import {mobileDriveClient} from './drive/client';
import {saveOffline} from './offline/native';
import {useSharedAlerts} from './components/useSharedAlerts';
import {Copy,FolderInput,Share2,Pencil,CheckSquare} from 'lucide-react';
import Login from './components/Login';
import ProfileAvatar from './components/ProfileAvatar';
import {useMobileAuth} from './auth/useMobileAuth';
import {useMobileDrive} from './drive/useMobileDrive';
import {useMobileTheme} from './theme';
import type {MobileDriveFile} from './drive/model';
import {move,useHomeLayout} from './home/layout';
import HomePanel from './home/HomePanel';
import CustomizeHome from './home/CustomizeHome';
import AppearancePanel from './components/AppearancePanel';
import OfflineSettings from './components/OfflineSettings';
import SyncPanel from './components/SyncPanel';
import FilePreview from './preview/FilePreview';
import {useOfflineFiles} from './offline/useOfflineFiles';
import {openOffline,type OfflineRecord} from './offline/native';
import {formatBytes,formatGigabytes} from './drive/model';
import SettingsPage from './settings/SettingsPage';
import AccountSettings from './settings/AccountSettings';
import AboutPage from './settings/AboutPage';
import {accountColours,useAccountPreferences} from './settings/accounts';
import {useNotifications,type NotificationItem} from './components/useNotifications';
import {NotificationCenter,NotificationSettings} from './components/NotificationCenter';
import {clearPreviewCache} from './preview/content';
import {DriveConsentRequired} from './auth/nativeGoogle';
import MobileSearch from './components/MobileSearch';
import {sharingNotice,transferNotice} from './components/notificationCopy';
import {useAndroidUpdates} from './updates/useAndroidUpdates';
import {UpdatePanel,UpdateMini,WhatsNew} from './updates/UpdatePanel';

type Overlay = 'more' | 'new' | 'folder' | 'accounts' | 'notifications' | 'customize' | 'filter' | 'pins' | 'sync' | 'appearance' | 'offline-settings' | 'account-settings' | 'notification-settings' | 'about' | 'rename' | 'updates' | 'whats-new' | null;
const titles: Partial<Record<Page, string>> = { 'My files': 'All files', 'Shared with me': 'Shared with me', 'Home': 'Home' };
const kindIcons: Partial<Record<DriveFile['type'], LucideIcon>> = { folder: Folder, image: FileImage, sheet: FileSpreadsheet };
function Glyph({ file }: { file: DriveFile }) { const Icon = kindIcons[file.type] || FileText; return <span className={`m-glyph ${file.type}`}><Icon size={21} strokeWidth={1.65}/></span>; }

export default function MobileApp({initialScreen = 'login'}:{initialScreen?:'login'|'workspace'} = {}) {
  const [screen,setScreen] = useState(initialScreen);
  const [demo,setDemo] = useState(initialScreen === 'workspace');
  const auth = useMobileAuth();
  const drive = useMobileDrive(auth.users,!demo && !!auth.user);
  const {dark,setDark,accent,setAccent}=useMobileTheme();
  const accountPreferences=useAccountPreferences();
  const notifications=useNotifications();
  const updates=useAndroidUpdates();
  const [searchOpen,setSearchOpen]=useState(false);
  const offline=useOfflineFiles(auth.users.map(user=>user.id));
  const rawAccounts = demo ? mockWorkspace.accounts.map(account=>({...account,known:true,unlimited:false})) : auth.users.map((user,index) => ({...user, used:(drive.snapshots[user.id]?.quota.used || 0)/1e9,total:(drive.snapshots[user.id]?.quota.total || 0)/1e9,known:!!drive.snapshots[user.id],unlimited:drive.snapshots[user.id]?.quota.total===null,color:['#9b85d8','#a5c5ae','#79adcc','#d8b576','#c68095'][index%5]}));
  const uiAccounts=rawAccounts.map((account,index)=>({...account,name:accountPreferences.preferences[account.id]?.label?.trim()||account.name,color:accountPreferences.preferences[account.id]?.color||accountColours[index%accountColours.length]}));
  const [page, setPage] = useState<Page>('Home');
  const [demoFiles, setFiles] = useState<DriveFile[]>(() => initialScreen === 'workspace' ? [...mockWorkspace.files] : []);
  const offlineFile=(record:OfflineRecord):MobileDriveFile=>({id:record.key,rawId:record.rawId,account:record.account,name:record.name,type:record.mime.includes('pdf')?'pdf':record.mime.startsWith('image/')?'image':record.mime.startsWith('video/')?'video':record.mime.startsWith('audio/')?'audio':'doc',mimeType:record.mime,byteSize:record.size,size:formatBytes(record.size),modified:record.modified,color:'blue',offline:true,remote:true});
  const files:DriveFile[] = demo ? demoFiles : drive.files.map(file=>({...file,offline:offline.records.some(record=>record.key===file.id),offlineStale:offline.records.some(record=>record.key===file.id&&record.modified!==file.modified)}));
  const offlineFiles:DriveFile[]=demo?demoFiles.filter(file=>file.offline):offline.records.map(record=>({...offlineFile(record),...files.find(file=>file.id===record.key),offline:true,trashed:false}));
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState(()=>{try{return localStorage.getItem('cirro-mobile-scope')||'all';}catch{return 'all';}});
  const home=useHomeLayout(scope);
  const {pins,setPins}=home;
  useEffect(()=>{try{localStorage.setItem('cirro-mobile-scope',scope);}catch{}},[scope]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [selected, setSelected] = useState<DriveFile | null>(null);
  const [grid, setGrid] = useState(false);
  const [sort, setSort] = useState<'asc'|'desc'>('asc');
  const [kind, setKind] = useState('all');
  const setNotice=(message:string)=>notifications.publish('Cirro',message);
  const [preview,setPreview]=useState<DriveFile|null>(null);
  const [permission,setPermission]=useState<string|null>(null);

  const [checks,setChecks]=useState<string[]>([]);
  const [destination,setDestination]=useState<{kind:'folder'|'upload'|'copy'|'move';files?:MobileDriveFile[];uploads?:PickedFile[]}|null>(null);
  const [folderDestination,setFolderDestination]=useState<Destination|null>(null);
  const [folderName,setFolderName]=useState('');
  const folderCreating=useRef(false);const [creating,setCreating]=useState(false);
  const [sharing,setSharing]=useState<MobileDriveFile|null>(null);
  const [confirmation,setConfirmation]=useState<TransferSpec|null>(null);
  const transfers=useTransfers(auth.users.map(user=>user.id),async()=>{await drive.refresh();await offline.refresh();},job=>{const account=job.spec.target?.account||job.spec.files?.[0]?.account;if(account&&auth.users.some(user=>user.id===account)){const notice=transferNotice(job);notifications.publish(notice.title,notice.message,{category:job.state==='complete'?'transfers':'errors',account,action:'transfers',native:!job.nativeNotified});}},async(file,signal,progress)=>{await saveOffline(file,signal,progress);},notifications.preferences.system&&notifications.preferences.transfers,notifications.ensureTransferNotifications);
  useSharedAlerts(drive.snapshots,notifications.publish);
  const [disconnect,setDisconnect]=useState<string|null>(null);
  const prompted=useRef(new Set<string>());
  const accessPrompted=useRef(new Set<string>());
  const resume=useRef<(()=>void)|null>(null);
  const requestPermission=(account:string,after?:()=>void)=>{resume.current=after||null;setOverlay(null);setSelected(null);setPermission(account);};
  const failure=(error:unknown,title='Could not complete this action',account?:string)=>{if(error instanceof DriveConsentRequired&&account){setSelected(null);setOverlay(null);notifications.publish('Drive access needed',error.message,{category:'errors',account,action:'connect'});}else{setSelected(null);setOverlay(null);notifications.publish(title,error instanceof Error?error.message:String(error),{category:'errors',account});}};
  useEffect(()=>{if(demo||!auth.user)return;for(const [id,state] of Object.entries(drive.states)){const key=id+state.error;if(state.error&&!prompted.current.has(key)){prompted.current.add(key);notifications.publish(state.needsAccess?'Drive access needed':'Sync needs attention',state.error,{category:state.needsAccess?'errors':'sync',account:id,action:state.needsAccess?'connect':'sync'});}}},[demo,auth.user?.id,drive.states,notifications.publish]);
  useEffect(()=>{
    if(demo||!auth.user||auth.loading||auth.busy||permission||overlay||selected||preview||disconnect||destination||sharing||confirmation||searchOpen)return;
    const missing=[...auth.users].sort((a,b)=>Number(b.id===auth.user?.id)-Number(a.id===auth.user?.id)).find(user=>drive.states[user.id]?.needsAccess&&!drive.states[user.id]?.syncing&&!accessPrompted.current.has(user.id));
    if(missing){accessPrompted.current.add(missing.id);requestPermission(missing.id);}
  },[demo,auth.user?.id,auth.users,auth.loading,auth.busy,drive.states,permission,overlay,selected,preview,disconnect,destination,sharing,confirmation,searchOpen]);
  useEffect(()=>{if(auth.error&&auth.user)notifications.publish('Account action failed',auth.error,{category:'errors'});},[auth.error]);
  const togglePin=(id:string)=>setPins(old=>old.includes(id)?old.filter(pin=>pin!==id):[...old,id]);
  const notificationItems=notifications.items.filter(item=>!item.account||uiAccounts.some(account=>account.id===item.account));
  function notificationAction(item:NotificationItem){if(item.action==='transfers'){go('Transfers');return;}if(item.account){setOverlay(null);if(item.action==='connect')requestPermission(item.account);else void drive.sync(item.account);}}
  const upload = useRef<HTMLInputElement>(null);

  useEffect(() => { if (auth.user && !demo) { setFiles([]); if(scope!=='all'&&!auth.users.some(user=>user.id===scope))setScope(auth.user.id); setFolder(null); setQuery(''); setSelected(null); setScreen('workspace'); } },[auth.user?.id,demo]);
  async function login() { if (await auth.signIn()) { accessPrompted.current.clear();setDemo(false); setScreen('workspace'); setOverlay(null); } }
  async function logout() { if (await auth.signOut()) { await drive.clear(); setDemo(false); setFiles([]); setPage('Home'); setFolder(null); setQuery(''); setScope('all'); setScreen('login'); setOverlay(null); setSelected(null);setPermission(null);notifications.clear();clearPreviewCache();setPreview(null);setDisconnect(null);prompted.current.clear();accessPrompted.current.clear(); } }
  const toMobile=(file:DriveFile):MobileDriveFile=>({...file,rawId:(file as MobileDriveFile).rawId||file.id});
  const requestUpload=async()=>{setOverlay(null);if(demo){upload.current?.click();return;}try{const picks=await pickPhoneFiles();if(picks.length)setDestination({kind:'upload',uploads:picks});}catch(error){failure(error,'Choose files');}};
  const chooseFolder=()=>{setFolderName('');setFolderDestination(null);setOverlay('folder');};
  const selectedFiles=checks.map(id=>files.find(file=>file.id===id)||offlineFiles.find(file=>file.id===id)).filter((file):file is DriveFile=>!!file);
  const toggleCheck=(id:string)=>setChecks(old=>old.includes(id)?old.filter(value=>value!==id):[...old,id]);
  async function runSpec(spec:TransferSpec){setSelected(null);setOverlay(null);setChecks([]);setConfirmation(null);if(demo){const ids=new Set(spec.files?.map(file=>file.id));setFiles(old=>spec.kind==='delete'?old.filter(file=>!ids.has(file.id)):old.map(file=>ids.has(file.id)?{...file,trashed:spec.kind==='trash'?true:spec.kind==='restore'?false:file.trashed,starred:spec.kind==='star'?true:spec.kind==='unstar'?false:file.starred}:file));setNotice('Updated in UI preview');return;}try{void transfers.run(spec).catch(error=>failure(error,'Transfer'));}catch(error){failure(error,'Transfer');}}
  function batch(kind:TransferSpec['kind'],items=selectedFiles){if(!items.length)return;const picked=items.map(toMobile);if(kind==='copy'||kind==='move'){setSelected(null);setDestination({kind,files:picked});}else if(kind==='trash'||kind==='delete')setConfirmation({kind,files:picked});else void runSpec({kind,files:picked});}
  function destinationChosen(target:Destination){const pending=destination;setDestination(null);if(!pending)return;if(pending.kind==='folder'){setFolderDestination(target);setOverlay('folder');}else void runSpec({kind:pending.kind,files:pending.files,uploads:pending.uploads,target});}
  const go = (next: Page) => { setChecks([]);setPage(next); setFolder(null); setQuery(''); setKind('all'); setOverlay(null); window.scrollTo(0, 0); };
  const open = (file: DriveFile) => { if (file.type === 'folder') { setFolder(file.id); setPage('My files'); setQuery(''); window.scrollTo(0, 0); } else setPreview(file); };
  const update = async (patch: Partial<DriveFile>) => { if (!selected) return; try { if (demo) setFiles(old=>old.map(file=>file.id===selected.id?{...file,...patch}:file)); else { if(patch.offline!==undefined){await offline.toggle(selected as MobileDriveFile);}else await drive.mutate(selected as MobileDriveFile,patch); } setSelected(null);setNotice(patch.offline!==undefined?'Offline copy updated':patch.trashed===true?'Moved to Trash':patch.trashed===false?'Restored':'Saved'); } catch(error){failure(error,'Could not save this change',selected.account);} };
  const live = files.filter(file => !file.trashed && (scope === 'all' || file.account === scope));
  const storageAccounts = uiAccounts.filter(account => scope === 'all' || account.id === scope);
  const storageUsed = storageAccounts.reduce((sum, account) => sum + account.used, 0);
  const storageTotal = storageAccounts.reduce((sum, account) => sum + account.total, 0);
  let visible = (page==='Offline files'?offlineFiles:files).filter(file => (scope === 'all' || file.account === scope) && (page === 'Trash' ? file.trashed : !file.trashed));
  if (query) visible = visible.filter(file => file.name.toLowerCase().includes(query.toLowerCase()));
  else if (page === 'Starred') visible = visible.filter(file => file.starred);
  else if (page === 'Shared with me') visible = visible.filter(file => file.shared && (!file.parent || !files.find(parent=>parent.id===file.parent)?.shared));
  else if (page === 'Offline files') visible = offlineFiles.filter(file=>scope==='all'||file.account===scope);
  else if (page === 'My files') visible = visible.filter(file => folder ? file.parent === folder : !file.parent && (demo || file.inMyDrive));
  else if (page === 'Home' || page === 'Recent') visible = visible.filter(file => file.type !== 'folder').sort((a,b)=>Date.parse((b as MobileDriveFile).viewedAt || b.modified || '')-Date.parse((a as MobileDriveFile).viewedAt || a.modified || ''));
  if (kind !== 'all') visible = visible.filter(file => kind === 'folder' ? file.type === 'folder' : file.type !== 'folder');
  visible = [...visible].sort((a,b)=>(sort==='asc'?1:-1)*a.name.localeCompare(b.name));
  const heading = query ? 'Search results' : folder ? files.find(file => file.id === folder)?.name : titles[page] || page;

  async function createFolder(event:FormEvent<HTMLFormElement>){event.preventDefault();if(folderCreating.current)return;const form=event.currentTarget;const name=String(new FormData(form).get('name')||'').trim();if(!name)return;if(!folderDestination){setDestination({kind:'folder'});setOverlay(null);return;}if(demo){setFiles(old=>[...old,{id:'local-'+Date.now(),name,type:'folder',account:folderDestination.account,size:'0 items',color:'blue',modified:'Today'}]);setOverlay(null);return;}folderCreating.current=true;setCreating(true);try{const target=await mobileDriveClient.getFile(folderDestination.account,folderDestination.folder);if(target.capabilities?.canAddChildren===false)throw new Error('This folder is read-only.');await mobileDriveClient.createFolder(folderDestination.account,name,folderDestination.folder);setOverlay(null);await drive.refresh(folderDestination.account);setNotice('Folder created');}catch(error){failure(error,'Create folder',folderDestination.account);}finally{folderCreating.current=false;setCreating(false);}}
  function fileList(items: DriveFile[]) {
    return items.length?<div className={`m-file-list ${grid?'is-grid':''}`}>{items.map(file=><FileRow key={file.id} file={file} account={uiAccounts.find(account=>account.id===file.account)?.name} selecting={checks.length>0} checked={checks.includes(file.id)} onToggle={()=>toggleCheck(file.id)} onOpen={()=>open(file)} onActions={()=>setSelected(file)}/>)}</div> : <div className="m-empty"><Folder size={34}/><h3>{query?'No results':!demo&&drive.syncing?'Syncing files…':!demo&&!drive.snapshots[scope==='all'?auth.user?.id||'':scope]?'Connect Drive to load files':page==='My files'&&kind==='files'?'No files in this folder':'No files'}</h3><p>{query?'Try another name or change your filters.':kind==='files'?'Folders are hidden by your filter.':''}</p>{kind!=='all'&&<button className="m-primary" onClick={()=>setKind('all')}>Show all items</button>}</div>;
  }
  const listHeader = (label: string) => <div className="m-section-title"><h2>{label}</h2><div><button aria-label="Select files" onClick={()=>{if(visible.length)setChecks([visible[0].id]);}}><CheckSquare size={19}/></button><button aria-label={sort==='asc'?'Sort files Z–A':'Sort files A–Z'} title={sort==='asc'?'A–Z':'Z–A'} onClick={() => setSort(sort==='asc'?'desc':'asc')}><ArrowUpDown size={17}/></button><button aria-label={grid ? 'Use list view' : 'Use grid view'} onClick={() => setGrid(!grid)}>{grid ? <LayoutList size={19}/> : <Grid2X2 size={19}/>}</button></div></div>;

  function closeOverlay(){if(overlay==='updates')updates.later();if(overlay==='whats-new')updates.dismissWhatsNew();setOverlay(null);}
  useEffect(()=>{
    if(auth.loading||auth.busy||overlay||permission||selected||preview||disconnect||destination||sharing||confirmation||searchOpen||transfers.busy)return;
    if(Object.entries(drive.states).some(([id,state])=>state.needsAccess&&!accessPrompted.current.has(id)))return;
    if(updates.whatsNew)setOverlay('whats-new');else if(updates.prompt){updates.consumePrompt();setOverlay('updates');}
  },[auth.loading,auth.busy,overlay,permission,selected,preview,disconnect,destination,sharing,confirmation,searchOpen,transfers.busy,drive.states,updates.whatsNew,updates.prompt]);
  const notificationBanner=notifications.banner?<button role="status" className="m-notice-banner" onClick={()=>{notifications.markRead();setOverlay('notifications');}}><img src="/branding/cirro-transparent-128.png" alt=""/><span><strong>{notifications.banner.title}</strong><small>{notifications.banner.message}</small></span></button> : null;
  if (screen === 'login' && !auth.user) return <Login onSignIn={() => void login()} busy={auth.busy} loading={auth.loading} error={auth.error} native={auth.native} onPreview={() => { setDemo(true); setFiles([...mockWorkspace.files]); setScreen('workspace'); window.scrollTo(0,0); }}/>;
  return <div className="m-app">
    <header className="m-topbar"><button className="m-brand" aria-label="Cirro home" onClick={() => go('Home')}><img src="/branding/cirro-transparent-128.png" alt=""/>Cirro</button><div><button className={'m-icon-button m-header-sync '+(drive.syncing?'is-syncing':'')} aria-label="Sync status" onClick={()=>setOverlay('sync')}><RefreshCw size={21}/>{Object.values(drive.states).some(state=>state.needsAccess||state.error)&&<i className="m-attention-dot"/>}</button><button className="m-icon-button" aria-label="Notifications" onClick={() => {notifications.markRead();setOverlay('notifications');}}><Bell size={21}/>{notificationItems.some(item=>!item.read)&&<i className="m-attention-dot"/>}</button><button className="m-profile-button" aria-label="Switch account" onClick={() => setOverlay('accounts')}>{scope==='all'?<span className="m-avatar m-unified-avatar" aria-label="Unified mode"><Layers size={23}/></span>:<ProfileAvatar user={auth.users.find(user=>user.id===scope)||{name:uiAccounts.find(account=>account.id===scope)?.name||'Account',picture:null}}/>}</button></div></header>
    <main>

      {folder && <button className="m-back" onClick={() => { setFolder(files.find(file => file.id === folder)?.parent || null); }}><ArrowLeft size={16}/> All files</button>}
      <div className="m-heading"><h1>{heading}</h1>{page === 'Home' && <button className="m-icon-button" aria-label="Customize home" onClick={() => setOverlay('customize')}><SlidersHorizontal size={21}/></button>}</div>
      {!['Settings', 'Storage', 'Transfers'].includes(page) && <><div className="m-search m-search-launcher"><button aria-label="Search files" onClick={()=>setSearchOpen(true)}><Search size={19}/><span>Search your files</span></button><button aria-label="Filter files" onClick={()=>setOverlay('filter')}><SlidersHorizontal size={18}/></button></div><div className="m-scope"><button onClick={() => setOverlay('accounts')}><span className="m-account-dots"><i/><i/></span>{scope === 'all' ? 'Unified' : uiAccounts.find(account => account.id === scope)?.name}<ChevronRight size={14}/></button><span>{kind !== 'all' ? `${kind === 'folder' ? 'Folders' : 'Files'} only` : `${live.length} items`}</span></div></>}

      {page==='Home'&&!query&&<HomePanel layout={home.layout} accounts={storageAccounts} files={[...files.filter(file=>scope==='all'||file.account===scope),...offlineFiles.filter(file=>(scope==='all'||file.account===scope)&&!files.some(item=>item.id===file.id))]} pins={pins} onHide={id=>home.setLayout(old=>({...old,hidden:[...old.hidden,id]}))} onOpen={open} onPage={go} onPin={()=>setOverlay('pins')} onUnpin={togglePin} pinSort={home.pinSort} onSortPins={()=>{const direction=home.pinSort==='asc'?'desc':'asc';home.setPinSort(direction);setPins(old=>[...old].sort((a,b)=>(direction==='asc'?1:-1)*(files.find(file=>file.id===a)?.name||a).localeCompare(files.find(file=>file.id===b)?.name||b)));}} onUpload={requestUpload} onFolder={chooseFolder} onCustomize={()=>setOverlay('customize')} onSync={()=>setOverlay('sync')} states={drive.states}/>}

      {page === 'Settings' && !query ? <SettingsPage user={auth.user} count={uiAccounts.length} used={storageUsed} location={offline.location.name} demo={demo} updateVersion={updates.release?.version} busy={auth.busy||transfers.busy} onOpen={setOverlay} onPage={go} onLogout={()=>void logout()} onLogin={()=>{setDemo(false);setFiles([]);setScreen('login');}}/> : page === 'Storage' && !query ? <>
        <section className="m-storage-card"><Cloud size={30}/><p>Storage used</p><h2>{formatGigabytes(storageUsed)} <span>{storageTotal ? '/ '+formatGigabytes(storageTotal) : 'used'}</span></h2><div className="m-meter"><i style={{ width: storageTotal?Math.min(100,storageUsed/storageTotal*100)+'%':'0%' }}/></div><small>{storageTotal?formatGigabytes(Math.max(0,storageTotal-storageUsed))+' available':'No storage limit reported'}</small></section><p className="m-label">ACROSS YOUR ACCOUNTS</p>{storageAccounts.map(account => <div className="m-account-storage" key={account.id}><div><span className="m-avatar" style={{ background: account.color }}>A</span><span><strong>{account.name}</strong><small>{account.email}</small></span><b>{formatGigabytes(account.used)}</b></div><div className="m-meter"><i style={{ width: account.total ? `${Math.min(100,account.used / account.total * 100)}%` : '0%', background: account.color }}/></div><small>{!account.known?'Not synced':account.unlimited?formatGigabytes(account.used)+' used · No limit reported':formatGigabytes(account.used)+' of '+formatGigabytes(account.total)+' used · '+formatGigabytes(Math.max(0,account.total-account.used))+' left'}</small></div>)}<button className="m-wide-link" onClick={() => { go('My files'); setKind('files'); }}>Explore your files <ArrowRight size={18}/></button>
      </> : page==='Transfers'&&!query?<TransferPage jobs={transfers.jobs} busy={transfers.busy} onCancel={transfers.cancel} onClear={transfers.clear} onRetry={job=>void transfers.run(job.spec,job).catch(error=>failure(error,'Retry transfer'))}/> : page === 'Home' && !query ? null : <section className={page === 'Home' && !query ? 'm-recent' : 'm-browse'}>{listHeader(page === 'Home' && !query ? 'Pick up where you left off' : query ? `${visible.length} results` : page === 'Trash' ? 'Recently deleted' : `${visible.length} ${visible.length === 1 ? 'item' : 'items'}`)}{fileList(visible)}{page === 'Home' && !query && <button className="m-wide-link" onClick={() => go('Recent')}>View all recent files <ArrowRight size={17}/></button>}</section>}

    </main>

    <nav className="m-bottom-nav" aria-label="Main navigation"><button aria-label="Home" aria-current={page === 'Home' ? 'page' : undefined} onClick={() => go('Home')}><House size={21}/><span>Home</span></button><button aria-label="All files" aria-current={page === 'My files' ? 'page' : undefined} onClick={() => go('My files')}><Folder size={21}/><span>Files</span></button><button className="m-add" aria-label="Add new" onClick={() => setOverlay('new')}><Plus size={26}/></button><button aria-label="Shared with me" aria-current={page === 'Shared with me' ? 'page' : undefined} onClick={() => go('Shared with me')}><Users size={21}/><span>Shared</span></button><button aria-label="More pages" aria-current={!['Home', 'My files', 'Shared with me'].includes(page) ? 'page' : undefined} onClick={() => setOverlay('more')}><MoreHorizontal size={23}/><span>More</span></button></nav>
    <input ref={upload} type="file" multiple hidden onChange={event => { if(!demo){event.target.value='';return;} const picks = Array.from(event.target.files || []); setFiles(old => [...old, ...picks.map((file, index): DriveFile => ({ id: `upload-${Date.now()}-${index}`, name: file.name, type: file.type.startsWith('image/') ? 'image' : 'doc', account: scope === 'all' ? 'personal' : scope, size: `${Math.max(1, Math.round(file.size / 1024))} KB`, modified: 'Just now', color: 'blue', parent: folder || undefined }))]); if (picks.length) { setOverlay(null); setPage('My files'); setNotice(`${picks.length} demo item(s) added · nothing uploaded`); } event.target.value = ''; }}/>
    {(!overlay&&!selected&&!permission&&!disconnect&&!preview)&&notificationBanner}

    {overlay && <Sheet title={{ more: 'Your workspace', new: 'Add new', folder: 'New folder', accounts: 'Your accounts', notifications: 'Notifications', customize: 'Customize Home', filter: 'File type', pins: 'Pinned folders',sync:'Sync',appearance:'Appearance','offline-settings':'Offline storage','account-settings':'Account settings','notification-settings':'Notifications','about':'About Cirro','rename':'Rename','updates':'Software update','whats-new':'What’s new' }[overlay]} onClose={closeOverlay}>
      {notificationBanner}
      {overlay === 'more' && <div className="m-page-grid">{[...navigation, { name: 'Settings' as Page, icon: Settings }].map(({ name, icon: Icon }) => <button key={name} aria-current={page === name ? 'page' : undefined} onClick={() => go(name)}><Icon size={23}/><span>{titles[name] && name !== 'Home' ? titles[name] : name}</span></button>)}</div>}
      {overlay === 'new' && <div className="m-sheet-options"><button onClick={requestUpload}><Upload/>Add files from your phone <ChevronRight size={18}/></button><button onClick={chooseFolder}><Folder/>Create a folder <ChevronRight size={18}/></button></div>}
      {overlay==='folder'&&<form onSubmit={createFolder} className="m-folder-form"><label htmlFor="folder-name">Folder name</label><input id="folder-name" name="name" value={folderName} onChange={event=>setFolderName(event.target.value)} autoFocus required maxLength={200} placeholder="Folder name"/><button type="button" className="m-wide-link" onClick={()=>{setOverlay(null);setDestination({kind:'folder'});}}><Folder size={20}/>{folderDestination?.name||'Choose Google account and folder'}<ChevronRight size={18}/></button><button className="m-primary" disabled={!folderDestination||creating}>{creating?'Creating…':'Create folder'}</button></form>}
      {overlay==='rename'&&selected&&<form className="m-folder-form" onSubmit={event=>{event.preventDefault();void update({name:String(new FormData(event.currentTarget).get('name')||'').trim()});setOverlay(null);}}><label htmlFor="rename-file">File name</label><input id="rename-file" name="name" required maxLength={200} defaultValue={selected.name}/><button className="m-primary">Save name</button></form>}
      {overlay==='accounts'&&<div className="m-account-chooser"><button className="m-unified-choice" aria-pressed={scope==='all'} onClick={()=>{setScope('all');setFolder(null);setQuery('');setOverlay(null);window.scrollTo(0,0);}}><span className="m-avatar m-unified-avatar"><Layers size={23}/></span><span><strong>Unified</strong><small>All {uiAccounts.length} connected accounts</small></span>{scope==='all'&&<Check size={21}/>}</button><p className="m-label">GOOGLE ACCOUNTS</p>{uiAccounts.map(account=>{const user=auth.users.find(user=>user.id===account.id);return <div className="m-account-choice" key={account.id}><button aria-pressed={scope===account.id} disabled={auth.busy} onClick={()=>{if(!demo)auth.select(account.id);setScope(account.id);setFolder(null);setQuery('');setOverlay(null);window.scrollTo(0,0);}}><ProfileAvatar user={user||{name:account.name,picture:null}}/><span><strong>{account.name}</strong><small>{account.email}</small></span>{scope===account.id&&<Check size={19}/>}</button>{!demo&&<button aria-label={'Disconnect '+account.name} disabled={auth.busy} onClick={()=>{setOverlay(null);setDisconnect(account.id);}}><LogOut size={18}/></button>}</div>;})}{!demo&&<div className="m-sheet-options"><button disabled={auth.busy||auth.users.length>=MAX_MOBILE_ACCOUNTS} onClick={()=>void login()}><Plus size={22}/><span>{auth.busy?'Signing in…':'Add Google account'}</span></button><button disabled={auth.busy} className="m-danger" onClick={()=>void logout()}><LogOut size={21}/><span>Sign out of all accounts</span></button></div>}</div>}
      {overlay==='notifications'&&<NotificationCenter items={notificationItems} onAction={notificationAction} onClear={notifications.clear}/>}
      {overlay==='notification-settings'&&<NotificationSettings value={notifications.preferences} onChange={notifications.setPreferences}/>}
      {overlay==='about'&&<AboutPage updates={updates} onOpenUpdates={()=>setOverlay('updates')}/>}
      {overlay==='updates'&&<UpdatePanel updates={updates} onLater={closeOverlay}/>}
      {overlay==='whats-new'&&<WhatsNew version={updates.build.version} onDone={closeOverlay}/>}
      {overlay==='account-settings'&&<AccountSettings users={demo?mockWorkspace.accounts.map(account=>({...account,picture:null})):auth.users} preferences={accountPreferences.preferences} onUpdate={accountPreferences.update} onAdd={()=>void login()} onDisconnect={id=>{setOverlay(null);setDisconnect(id);}} busy={auth.busy} demo={demo}/>}
      {overlay==='customize'&&<CustomizeHome {...home} scopeName={scope==='all'?'Unified Home':(uiAccounts.find(account=>account.id===scope)?.name||'your')+' Home'} onPins={()=>setOverlay('pins')}/>}
      {overlay==='sync'&&<SyncPanel users={demo?mockWorkspace.accounts:auth.users} states={drive.states} onConnect={id=>demo?setNotice('Native Drive permissions are available in the Android app.'):requestPermission(id)} onSync={id=>void drive.sync(id)} onSyncAll={()=>void drive.sync()}/>}
      {overlay==='appearance'&&<AppearancePanel dark={dark} onDark={()=>setDark(!dark)} accent={accent} onAccent={setAccent}/>}
      {overlay==='offline-settings'&&<OfflineSettings location={offline.location} count={offline.records.length} busy={offline.busy} onChoose={()=>void offline.choose().catch(error=>failure(error,'Offline folder'))} onReset={()=>void offline.resetLocation().catch(error=>failure(error,'Offline folder'))}/>}
      {overlay === 'pins' && <><div className="m-pin-order">{pins.map(id=>live.find(file=>file.id===id)).filter((file):file is DriveFile=>!!file).map((file,index)=><div className="m-customize-row" key={file.id}><button onClick={()=>togglePin(file.id)} aria-label={'Unpin '+file.name}><span>{file.name}</span><Pin size={18}/></button><button aria-label={'Move '+file.name+' up'} disabled={!index} onClick={()=>setPins(old=>move(old,file.id,-1))}><ArrowUp size={18}/></button><button aria-label={'Move '+file.name+' down'} disabled={index===pins.length-1} onClick={()=>setPins(old=>move(old,file.id,1))}><ArrowDown size={18}/></button></div>)}</div><div className="m-sheet-options">{live.filter(file => file.type === 'folder').map(file => <button key={file.id} aria-pressed={pins.includes(file.id)} onClick={() => togglePin(file.id)}><Glyph file={file}/><span><strong>{file.name}</strong><small>{uiAccounts.find(account => account.id === file.account)?.name}</small></span>{pins.includes(file.id)?<Check size={21}/>:<Plus size={21}/>}</button>)}</div></>}
      {overlay === 'filter' && <div className="m-sheet-options">{['all', 'folder', 'files'].map(value => <button key={value} onClick={() => { setKind(value); setOverlay(null); }}><span>{value === 'all' ? 'All file types' : value === 'folder' ? 'Folders only' : 'Files only'}</span>{kind === value && <Check size={19}/>}</button>)}</div>}
    </Sheet>}
    {selected&&!overlay&&!confirmation&&<Sheet title={selected.name} onClose={() => setSelected(null)}><div className="m-detail"><Glyph file={selected}/><div><strong>{selected.name}</strong><p>{selected.size} · {uiAccounts.find(account => account.id === selected.account)?.name}</p></div></div><div className="m-sheet-options"><button onClick={()=>{setChecks([selected.id]);setSelected(null);}}><CheckSquare/>Select files</button>{!selected.trashed&&<><button disabled={transfers.busy} onClick={()=>batch('copy',[selected])}><Copy/>Copy to…</button><button disabled={transfers.busy} onClick={()=>batch('move',[selected])}><FolderInput/>Move to…</button><button disabled={(selected as MobileDriveFile).canEdit===false} onClick={()=>setOverlay('rename')}><Pencil/>Rename</button><button onClick={()=>{setSharing(toMobile(selected));setSelected(null);}}><Share2/>Share and manage access</button></>}{selected.type!=='folder'&&<button onClick={()=>{setPreview(selected);setSelected(null);}}><Eye size={21}/>Preview file</button>}{selected.offline&&!demo&&<button onClick={()=>void openOffline(selected.id).catch(error=>failure(error,'Open offline file'))}><FolderOpen size={21}/>Open offline copy</button>}{!demo && selected.webViewLink && <button onClick={()=>{const url=new URL(selected.webViewLink!);if(url.protocol==='https:' && ['drive.google.com','docs.google.com'].includes(url.hostname))window.open(url.href,'_blank','noopener,noreferrer');}}><ExternalLink size={21}/>Open in Google Drive</button>}{selected.trashed ? <><button disabled={!demo && (drive.syncing || selected.canUntrash===false)} onClick={() => { batch('restore',[selected]); }}><ArrowLeft/>Restore file</button><button className="m-danger" disabled={transfers.busy||(selected as MobileDriveFile).canDelete===false} onClick={()=>batch('delete',[selected])}><Trash2/>Delete permanently</button></> : <>{selected.type === 'folder' && <button onClick={() => { togglePin(selected.id); setSelected(null); }}><Pin/>{pins.includes(selected.id) ? 'Unpin from Home' : 'Pin to Home'}</button>}<button disabled={!demo && drive.syncing} onClick={() => { void update({ starred: !selected.starred }); }}><Star/>{selected.starred ? 'Remove from Starred' : 'Add to Starred'}</button><button disabled={offline.busy||transfers.busy||(selected as MobileDriveFile).canDownload===false} onClick={() => { if(selected.offline&&selected.type!=='folder')void update({offline:false});else batch('offline',[selected]); }}><CloudOff/>{selected.offline ? 'Remove offline copy' : 'Make available offline'}</button><button className="m-danger" disabled={!demo && (drive.syncing || selected.canTrash===false)} onClick={() => { batch('trash',[selected]); }}><Trash2/>Move to Trash</button></>}</div></Sheet>}
    {checks.length>0&&<div className="m-selection-bar"><div><strong>{checks.length} selected</strong><button onClick={()=>setChecks(visible.map(file=>file.id))}>Select all</button><button onClick={()=>setChecks([])}>Done</button></div><div><button disabled={transfers.busy} onClick={()=>batch('copy')}><Copy size={21}/>Copy</button><button disabled={transfers.busy} onClick={()=>batch('move')}><FolderInput size={21}/>Move</button><button disabled={transfers.busy} onClick={()=>batch(page==='Trash'?'delete':'trash')}><Trash2 size={21}/>{page==='Trash'?'Delete':'Trash'}</button><button disabled={transfers.busy} onClick={()=>batch(page==='Trash'?'restore':selectedFiles.every(file=>file.starred)?'unstar':'star')}><Star size={21}/>{page==='Trash'?'Restore':selectedFiles.every(file=>file.starred)?'Unstar':'Star'}</button><button disabled={transfers.busy} onClick={()=>batch('offline')}><CloudOff size={21}/>Offline</button>{checks.length===1&&<button onClick={()=>{setSharing(toMobile(selectedFiles[0]));setChecks([]);}}><Share2 size={21}/>Share</button>}</div></div>}
    {destination&&<Sheet title={destination.kind==='folder'?'Folder location':destination.kind==='upload'?'Upload location':destination.kind==='copy'?'Copy to':'Move to'} onClose={()=>setDestination(null)}>{destination.kind==='move'&&<p className="m-settings-note">Between accounts, Cirro verifies a copy before moving the original to Trash. Google documents must be accessible to the destination account.</p>}<DestinationPicker accounts={uiAccounts} snapshots={drive.snapshots} initialAccount={scope==='all'?undefined:scope} onChoose={destinationChosen} onConnect={id=>{setDestination(null);requestPermission(id);}}/></Sheet>}
    {sharing&&<Sheet title="Share" onClose={()=>setSharing(null)}><SharingPanel file={sharing} onChanged={event=>{const notice=sharingNotice(event);notifications.publish(notice.title,notice.message,{category:'activity',account:sharing.account});}}/></Sheet>}
    {confirmation&&<Sheet title={confirmation.kind==='delete'?'Delete permanently?':'Move to Trash?'} onClose={()=>setConfirmation(null)}><p className="m-dialog-message">{confirmation.files?.length} selected items{confirmation.kind==='delete'?' will be permanently deleted from Google Drive. This cannot be undone.':' will be moved to Trash in their own Google accounts.'}</p><button className="m-primary" disabled={transfers.busy} onClick={()=>void runSpec(confirmation)}>{confirmation.kind==='delete'?'Delete permanently':'Move to Trash'}</button><button className="m-wide-link" onClick={()=>setConfirmation(null)}>Cancel</button></Sheet>}
    {searchOpen&&<MobileSearch files={files} accounts={uiAccounts} scope={scope} onClose={()=>setSearchOpen(false)} onOpen={file=>{setSearchOpen(false);open(file);}}/>}
    {!overlay&&!searchOpen&&!preview&&!checks.length&&<UpdateMini updates={updates} onOpen={()=>setOverlay('updates')}/>}
    {preview&&<FilePreview file={preview} onClose={()=>setPreview(null)} onPermission={account=>{const file=preview;setPreview(null);requestPermission(account,()=>setPreview(file));}}/>}
    {permission&&<Sheet title="Allow Google Drive access" onClose={()=>{setPermission(null);resume.current=null;}}><div className="m-permission-prompt"><span className="m-glyph"><HardDrive size={26}/></span><h3>{auth.users.find(user=>user.id===permission)?.name||'Google account'}</h3><p>{auth.users.find(user=>user.id===permission)?.email}</p><p>Cirro needs access to list, preview and organize files in this account. Google will ask you to approve Drive access. Choose this same account in the Google account picker.</p>{drive.states[permission]?.error&&<p role="alert">{drive.states[permission].error}</p>}<button className="m-primary" disabled={drive.states[permission]?.syncing} onClick={async()=>{if(await drive.connect(permission)){setPermission(null);const after=resume.current;resume.current=null;after?.();}}}>{drive.states[permission]?.syncing?'Connecting…':'Continue with Google'}</button><button className="m-wide-link" onClick={()=>{setPermission(null);resume.current=null;}}>Not now</button></div></Sheet>}

    {disconnect&&<Sheet title="Disconnect account?" onClose={()=>setDisconnect(null)}><p className="m-dialog-message">This removes {auth.users.find(user=>user.id===disconnect)?.email} from Cirro on this device. Offline copies stay in their folders.</p><button className="m-primary" disabled={auth.busy} onClick={async()=>{const id=disconnect;if(await auth.remove(id)){clearPreviewCache();setScope('all');setDisconnect(null);if(auth.users.length===1)setScreen('login');}}}>Disconnect</button><button className="m-wide-link" onClick={()=>setDisconnect(null)}>Cancel</button></Sheet>}
  </div>;
}
