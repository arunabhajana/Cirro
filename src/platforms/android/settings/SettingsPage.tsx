import {Bell,ChevronRight,CloudOff,FolderOpen,HardDrive,Info,Palette,SlidersHorizontal,Users,LogOut,ArrowDownToLine,type LucideIcon} from 'lucide-react';
import type {Page} from '../../../shared/navigation';
import ProfileAvatar from '../components/ProfileAvatar';
import AccessRequest from '../components/AccessRequest';
import type {MobileUser} from '../auth/googleIdentity';
import {formatGigabytes} from '../drive/model';
type SettingsAction='account-settings'|'appearance'|'offline-settings'|'notification-settings'|'about'|'customize'|'accounts'|'updates';
export default function SettingsPage({user,count,used,location,demo,busy,onOpen,onPage,onLogout,onLogin,updateVersion}:{user:MobileUser|null;count:number;used:number;location:string;demo:boolean;busy:boolean;onOpen:(value:SettingsAction)=>void;onPage:(page:Page)=>void;onLogout:()=>void;onLogin:()=>void;updateVersion?:string}){
 const group=(title:string,rows:{icon:LucideIcon;label:string;detail?:string;colour:string;run:()=>void}[])=><section className="m-settings-section"><h2>{title}</h2><div className="m-ios-group">{rows.map(({icon:Icon,label,detail,colour,run})=><button key={label} onClick={run}><span className="m-settings-icon" style={{background:colour}}><Icon size={19}/></span><span><strong>{label}</strong>{detail&&<small>{detail}</small>}</span><ChevronRight size={17}/></button>)}</div></section>;
 return <div className="m-settings-page"><button className="m-settings-profile" onClick={()=>onOpen('account-settings')}><ProfileAvatar user={user||{name:'Cirro',picture:null}} large/><span><strong>{user?.name||'Cirro preview'}</strong><small>{user?.email||'Explore your workspace'}</small></span><ChevronRight size={19}/></button>
 {group('Accounts',[{icon:Users,label:'Account settings',detail:`${count} connected · Labels and colours`,colour:'#007aff',run:()=>onOpen('account-settings')}])}
 {group('Personalize',[{icon:Palette,label:'Appearance',detail:'Theme and accent colour',colour:'#8c5bd7',run:()=>onOpen('appearance')},{icon:SlidersHorizontal,label:'Customize Home',detail:'Personal to the selected account or Unified',colour:'#5865cf',run:()=>onOpen('customize')},{icon:Bell,label:'Notifications',colour:'#e65166',run:()=>onOpen('notification-settings')}])}
 {group('Files and storage',[{icon:HardDrive,label:'Storage',detail:formatGigabytes(used)+' used',colour:'#219a82',run:()=>onPage('Storage')},{icon:CloudOff,label:'Offline files',colour:'#5f839b',run:()=>onPage('Offline files')},{icon:FolderOpen,label:'Offline location',detail:location,colour:'#cc9022',run:()=>onOpen('offline-settings')}])}
 {updateVersion&&<button className="m-settings-update" onClick={()=>onOpen('updates')}><span className="m-settings-icon"><ArrowDownToLine size={19}/></span><span><strong>Update available</strong><small>Cirro {updateVersion} is ready for you</small></span><ChevronRight size={18}/></button>}
 {group('Cirro',[{icon:ArrowDownToLine,label:'Software update',detail:updateVersion?'Update available':'Check for updates',colour:'#007aff',run:()=>onOpen('updates')},{icon:Info,label:'About Cirro',detail:'Version, release notes and updates',colour:'#78808e',run:()=>onOpen('about')}])}
 <AccessRequest/>{demo?<button className="m-signout" onClick={onLogin}>View sign-in screen</button>:<button className="m-ios-signout" disabled={busy} onClick={onLogout}><LogOut size={18}/>{busy?'Signing out…':'Sign out of all accounts'}</button>}
 <p className="m-settings-footer">Cirro · A calmer home for your files</p></div>;
}
