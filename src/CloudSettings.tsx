import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {listen} from '@tauri-apps/api/event';
import {AlertTriangle,CloudDownload,FolderOpen,Trash2,X} from 'lucide-react';
import {invoke} from './ipc';
import {beginOperation} from './operations';
import {accounts} from './data';

type Source={id:string;name:string;account:string};
type CloudRoot={path:string;name:string;account:string;pair:string;status:string;error?:string};
type Transfer={id:string;name?:string;bytes?:number;total?:number;done?:boolean};
type Confirmation={kind:'create';source:Source}|{kind:'remove';root:CloudRoot};

function CloudConfirmation({confirmation,onCancel,onConfirm}:{confirmation:Confirmation;onCancel:()=>void;onConfirm:()=>void}){
 const dialog=useRef<HTMLElement>(null);
 const removing=confirmation.kind==='remove';
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
 return createPortal(<div className="modal-overlay cloud-confirm-overlay" onClick={onCancel}><section ref={dialog} className="modal cloud-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="cloud-confirm-title" aria-describedby="cloud-confirm-description" onClick={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape')onCancel();if(event.key==='Tab'){const buttons=Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]);if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===buttons.at(-1)){event.preventDefault();buttons[0]?.focus();}}}}>
  <div className="modal-heading"><div><span className="eyebrow">{removing?'REMOVE CLOUD VIEW':'PREVIEW FEATURE'}</span><h2 id="cloud-confirm-title">{removing?'Remove Cirro Cloud view?':'Try Cirro Cloud preview?'}</h2></div><button className="icon-button" aria-label="Close cloud confirmation" onClick={onCancel}><X size={19}/></button></div>
  <p id="cloud-confirm-description" className="modal-description">{removing?`Remove “${confirmation.root.name}” from Cirro Cloud and Explorer. Downloads in this view will stop.`:'Cirro Cloud is an experimental preview. Use your normal Flow folder for editing and two-way sync.'}</p>
  <div className="cloud-confirm-policy"><AlertTriangle size={20}/><div><strong>{removing?'What happens to your files':'Current preview limits'}</strong>{removing?<><p>Fully downloaded files stay in their local folder. Windows removes online-only placeholders and unfinished downloads from this computer.</p><p>Your Google Drive files and normal Flow folder stay unchanged.</p><p className="flow-path">{confirmation.root.path}</p></>:<><p>Cloud views are read-only snapshots. New cloud changes need a fresh view; editing and uploads through placeholders are not available yet.</p><p>Google editor documents and shortcuts are excluded. Cirro must be running and online to download files that are not already saved.</p></>}</div></div>
  <div className="modal-actions"><button className="secondary-button" onClick={onCancel}>Cancel</button><button className="primary-button" onClick={onConfirm}>{removing?'Remove cloud view':'Enable preview'}</button></div>
 </section></div>,document.body);
}

export function CloudActivity(){
 const [error,setError]=useState('');
 const [flow,setFlow]=useState(false);
 useEffect(()=>{
  const operations=new Map<string,ReturnType<typeof beginOperation>>();
  const progress=listen<Transfer>('cirro-cloud-progress',({payload})=>{
   if(payload.done){operations.get(payload.id)?.finish();operations.delete(payload.id);return;}
   let operation=operations.get(payload.id);
   if(!operation){operation=beginOperation(`Downloading · ${payload.name||'Cloud file'}`);operations.set(payload.id,operation);}
   if(payload.total)operation.update((payload.bytes||0)/payload.total*100);
  });
  const errors=listen<string>('cirro-cloud-error',({payload})=>{setFlow(false);setError(payload);});
  const flowErrors=listen<{name:string;error:string;retryAt:number;paused:boolean}>('cirro-flow-error',({payload})=>{setFlow(true);setError(`${payload.name}: ${payload.error}${payload.retryAt?` · Retrying at ${new Date(payload.retryAt*1000).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`:' · Paused for review in Storage & sync settings.'}`);});
  return()=>{void progress.then(stop=>stop());void errors.then(stop=>stop());void flowErrors.then(stop=>stop());operations.forEach(operation=>operation.finish());};
 },[]);
 return error?<aside className="cloud-failure" role="alert"><CloudDownload size={19}/><div><strong>{flow?'Cirro Flow needs attention':'Cloud download needs attention'}</strong><p>{error}</p><small>{flow?'Your sync and recovery state is retained. Review the folder status in Settings → Storage & sync.':'Downloaded files remain available. For a network failure, reconnect and open the file again.'}</small></div><button className="icon-button" aria-label="Dismiss sync error" onClick={()=>setError('')}><X size={17}/></button></aside>:null;
}

export default function CloudSettings({sources}:{sources:Source[]}){
 const [roots,setRoots]=useState<CloudRoot[]>([]);
 const [busy,setBusy]=useState<string|null>(null);
 const [error,setError]=useState('');
 const [confirmation,setConfirmation]=useState<Confirmation|null>(null);
 const [notice,setNotice]=useState('');
 async function reload(){const value=await invoke<CloudRoot[]>('cloud_files_command',{action:'list',id:null});setRoots(Array.isArray(value)?value:[]);}
 useEffect(()=>{void reload().catch(reason=>setError(String(reason)));},[]);
 async function create(source:Source){
  setBusy(source.id);setError('');setNotice('');const operation=beginOperation(`Preparing Cirro Cloud · ${source.name}`);
  try{const path=await invoke<string>('cloud_files_command',{action:'create',id:source.id});await reload();await invoke('cloud_files_command',{action:'open',id:path});}
  catch(reason){setError(String(reason));await reload().catch(()=>{});}
  finally{operation.finish();setBusy(null);}
 }
 async function remove(root:CloudRoot){
  setBusy(root.path);setError('');setNotice('');const operation=beginOperation(`Removing Cirro Cloud · ${root.name}`);
  try{await invoke('cloud_files_command',{action:'remove',id:root.path});await reload();setNotice('Cloud view removed. Downloaded files remain in their local folder.');}
  catch(reason){setError(String(reason));await reload().catch(()=>{});}
  finally{operation.finish();setBusy(null);}
 }
 async function open(path:string){try{await invoke('cloud_files_command',{action:'open',id:path});}catch(reason){setError(String(reason));}}
 function view(root:CloudRoot){return <div className="cloud-view" key={root.path}><div><strong>{root.name} · {root.status}</strong><p title={root.path}>{root.path}</p>{root.error&&<p className="flow-error">{root.error}</p>}</div><div className="cloud-view-actions"><button className="text-button" disabled={!!busy} onClick={()=>void open(root.path)}><FolderOpen size={15}/>Open</button><button className="text-button" disabled={!!busy} onClick={()=>setConfirmation({kind:'remove',root})}><Trash2 size={15}/>{busy===root.path?'Removing…':'Remove'}</button></div></div>;}
 return <section className="cloud-settings" aria-label="Windows download on demand">
  <div className="flow-heading"><span className="flow-symbol"><CloudDownload size={22}/></span><div><h3>Cirro Cloud <span className="cloud-preview-badge">Preview</span></h3><p>Windows download on demand</p></div></div>
  <p className="flow-description">Browse a Flow folder in Explorer without downloading its contents first. Opening a file downloads it; downloaded files can be read offline while Cirro is closed.</p>
  <div className="flow-policy"><strong>Read-only cloud views</strong><p>Each view captures the folder listing at creation. Create a fresh view to see newer cloud changes; older views are kept. Editing and uploads stay in your fully synced Flow folder. Google editor documents and shortcuts are excluded. Cirro must be running to download online-only files.</p></div>
  {error&&<p className="flow-error" role="alert">{error}</p>}
  {notice&&<p className="flow-description" role="status">{notice}</p>}
  <div className="flow-pairs">{sources.map(source=>{const views=roots.filter(root=>root.pair===source.id);return <article className="flow-pair" key={source.id}>
   <div className="flow-pair-heading"><strong>{source.name}</strong><span>{accounts.find(account=>account.id===source.account)?.name||'Google Drive'}</span></div>
   <div className="flow-actions"><button className="secondary-button" disabled={!!busy} onClick={()=>setConfirmation({kind:'create',source})}><CloudDownload size={15}/>{busy===source.id?'Creating cloud view…':views.length?'Create fresh cloud view':'Create cloud view'}</button></div>
   {views.map(view)}
  </article>;})}</div>
  {roots.filter(root=>!sources.some(source=>source.id===root.pair)).map(view)}
  {!sources.length&&<p className="flow-description">Add a Flow folder above to create its cloud view.</p>}
  <p className="flow-note">Views are stored in your Windows user folder → Cirro Cloud → account. Windows 10 version 1709 or later and a local NTFS volume are required.</p>
  {confirmation&&<CloudConfirmation confirmation={confirmation} onCancel={()=>setConfirmation(null)} onConfirm={()=>{setConfirmation(null);if(confirmation.kind==='create')void create(confirmation.source);else void remove(confirmation.root);}}/>}
 </section>;
}
