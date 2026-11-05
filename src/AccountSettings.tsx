import {accountColors,validAccountColor} from './accountColors';
import type {GoogleUser} from './auth';
import ProgressBar from './ProgressBar';
import {useEffect,useRef,useState} from 'react';
import {invoke} from './ipc';
import {Check,CheckCheck,LogOut,Pencil,X} from 'lucide-react';
import {AccountAvatar,useAuth} from './auth';
import {accounts} from './data';

// Keep each connection's controls and edit state together as accounts are added.
function AccountCard({user}:{user:GoogleUser}){
 const {signOut,phase}=useAuth();
 const [color,setColor]=useState(accounts.find(account=>account.id===user.id)?.color||accountColors[0]);
 const [label,setLabel]=useState('');const [draft,setDraft]=useState('');
 const [editing,setEditing]=useState(false);const [ready,setReady]=useState(false);
 const [saving,setSaving]=useState(false);const [message,setMessage]=useState('');
 const editButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{let active=true;setReady(false);setEditing(false);setMessage('');void invoke<string|null>('drive_preference',{key:'accountLabel',accountId:user.id}).then(value=>{if(active){setLabel(value||'');setReady(true);}}).catch(error=>{if(active)setMessage(String(error));});return()=>{active=false;};},[user?.id]);
 if(!user)return null;
 const account=accounts.find(account=>account.email===user.email);
 const total=account?.total||0;const used=account?.used||0;
 const percent=total?Math.min(100,Math.round(used/total*100)):0;
 async function changeColor(next:string){if(!validAccountColor(next))return;setSaving(true);setMessage('');try{await invoke('drive_setting',{key:'accountColor',value:next,accountId:user.id});setColor(next);window.dispatchEvent(new Event('cirro-account-label'));setMessage('Colour saved');}catch(error){setMessage(String(error));}finally{setSaving(false);}}
 function close(){setEditing(false);editButton.current?.focus();}
 async function save(){setSaving(true);setMessage('');try{const next=draft.trim();await invoke('drive_setting',{key:'accountLabel',value:next,accountId:user.id});setLabel(next);window.dispatchEvent(new Event('cirro-account-label'));close();setMessage('Label saved');}catch(error){setMessage(String(error));}finally{setSaving(false);}}
 return <article className="connection-card" aria-label={`Google account ${user.email}`}>
  <header className="connection-header"><AccountAvatar user={user}/><div className="connection-identity"><strong>{user.name}</strong><span title={user.email}>{user.email}</span></div><span className="connection-status"><CheckCheck size={13}/>Connected</span></header>
  <div className="connection-label-row"><span className="connection-label-title">Account label</span>{!editing?<><span className="connection-label-chip">{label||'No label'}</span><button ref={editButton} className="text-button" disabled={!ready||phase==='signing-out'} onClick={()=>{setDraft(label);setMessage('');setEditing(true);}} aria-label={`Edit label for ${user.email}`}><Pencil size={13}/>{label?'Edit':'Add label'}</button></>:<form className="connection-label-editor" onSubmit={event=>{event.preventDefault();void save();}}><input autoFocus aria-label={`Account label for ${user.email}`} value={draft} maxLength={40} disabled={saving} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'&&!saving){event.preventDefault();event.stopPropagation();close();}}}/><button className="icon-button" type="submit" disabled={saving} aria-label="Save account label"><Check size={16}/></button><button className="icon-button" type="button" disabled={saving} aria-label="Cancel label editing" onClick={close}><X size={16}/></button><div className="connection-label-presets">{['Personal','Work'].map(value=><button key={value} type="button" disabled={saving} onClick={()=>setDraft(value)}>{value}</button>)}<button type="button" disabled={saving||!draft} onClick={()=>setDraft('')}>Clear</button></div></form>}</div>
  {editing&&<p className="connection-label-help">Shown in the sidebar, file lists, and storage widgets.</p>}
  <div className="connection-color-row"><span>Account colour</span><div className="account-color-options" role="group" aria-label={`Colour for ${user.email}`}>{accountColors.map(option=><button key={option} className="account-color-swatch" style={{background:option}} aria-label={`Use ${option} for ${user.email}`} aria-pressed={color===option} disabled={saving} onClick={()=>void changeColor(option)}>{color===option&&<Check size={13}/>}</button>)}<label className="custom-account-color" title="Choose a custom colour"><input type="color" aria-label={`Custom colour for ${user.email}`} value={color} disabled={saving} onChange={event=>void changeColor(event.target.value)}/></label></div></div>
  <footer className="connection-footer"><div className="connection-quota"><span>{used.toFixed(1)} GB{total>0?` of ${total.toFixed(1)} GB used`:' used'}</span>{total>0&&<ProgressBar className="connection-quota-track" value={percent} label="Account storage used" meter/>}</div><button className="text-button connection-signout" disabled={saving||phase==='signing-out'} onClick={()=>void signOut(user.id)}><LogOut size={14}/>{phase==='signing-out'?'Signing out…':'Sign out'}</button></footer>
  {message&&<p className="connection-message" role="status">{message}</p>}
 </article>;
}

export default function AccountSettings(){const {users,signIn,phase}=useAuth();return <><div className="preference-row"><div><h3>Connected Google accounts</h3><p>Edit labels, colours, and connections for each account.</p></div><button className="secondary-button" disabled={phase!=="ready"} onClick={()=>void signIn()}>Add account</button></div><div className="connection-list">{users.map(user=><AccountCard key={user.id} user={user}/>)}</div></>;}
