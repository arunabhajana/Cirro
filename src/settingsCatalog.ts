import {Bell,CircleHelp,FolderSync,HardDrive,Info,Laptop,Monitor,Settings,ShieldCheck,Users,ArrowLeftRight} from 'lucide-react';
export const settingsSections=[
 {id:'general',title:'General',group:'Workspace',icon:Settings,description:'Home and sidebar layout.'},
 {id:'appearance',title:'Appearance',group:'Workspace',icon:Monitor,description:'Choose how Cirro looks.'},
 {id:'accounts',title:'Accounts',group:'Workspace',icon:Users,description:'Manage connected Google accounts.'},
 {id:'files',title:'Files & downloads',group:'Device',icon:ArrowLeftRight,description:'Refresh, upload conflicts and download locations.'},
 {id:'sync',title:'Sync folders',group:'Device',icon:FolderSync,description:'Manage Cirro Flow and cloud views.'},
 {id:'notifications',title:'Notifications',group:'Device',icon:Bell,description:'Choose when Cirro alerts you.'},
 {id:'startup',title:'Startup',group:'Device',icon:Laptop,description:'Control how Cirro starts and runs in the background.'},
 {id:'privacy',title:'Security & privacy',group:'Device',icon:ShieldCheck,description:'App lock and local file history.'},
 {id:'local',title:'Local storage',group:'Device',icon:HardDrive,description:'Review disk usage and manage cached data.'},
 {id:'support',title:'Support & diagnostics',group:'Help',icon:CircleHelp,description:'Troubleshoot Cirro and create a diagnostic report.'},
 {id:'about',title:'About',group:'Help',icon:Info,description:'Version, updates and release notes.'},
] as const;
export type SettingsSectionId=typeof settingsSections[number]['id'];
export type SettingEntry={section:SettingsSectionId;title:string;description:string;keywords:string;target?:string};
const entries=(section:SettingsSectionId,items:[string,string,string,string?][]):SettingEntry[]=>items.map(([title,description,keywords,target])=>({section,title,description,keywords,target}));
export const settingEntries:SettingEntry[]=[
 ...entries('general',[
 ['Home layout','Choose pinned items and dashboard widgets.','customize arrange folders widgets unified personal'],
 ['Sidebar','Show, hide and arrange navigation and pinned items.','customize transfers density compact width']]),
 ...entries('appearance',[['Theme','Use Light, Dark or your system appearance.','colour color display automatic mode','Theme']]),
 ...entries('accounts',[
 ['Connected Google accounts','Connect another account or sign out.','add remove disconnect login email'],
 ['Account labels','Name your accounts throughout Cirro.','personal work rename tags','Connected Google accounts'],
 ['Account colours','Choose a different colour for each account.','color badge custom','Connected Google accounts']]),
 ...entries('files',[
 ['Automatic refresh','Refresh Drive metadata while Cirro is running.','sync minute background'],
 ['Pause on metered connections','Pause background work on limited networks.','wifi data internet bandwidth cellular'],
 ['File upload conflicts','Keep both, replace or ask when names match.','collision duplicate overwrite'],
 ['Default download folder','Choose where downloads are saved.','location directory path save'],
 ['Offline files folder','Choose the offline download location for each account.','location directory path local save browse','Offline files']]),
 ...entries('sync',[
 ['Cirro Flow','Sync folders between this computer and Google Drive.','two way bidirectional computer add pause resume'],
 ['Sync recovery','Review conflicts and restore recovery copies.','backup restore conflict deleted','Cirro Flow'],
 ['Cirro Cloud','Manage Windows download-on-demand cloud views.','placeholder explorer online preview']]),
 ...entries('notifications',[
 ['Desktop notifications','Show Windows notifications from Cirro.','alerts banner enable disable'],
 ['Upload complete','Notify when uploads finish.','transfer success'],
 ['Transfer errors','Alert when a transfer or sync needs attention.','failure offline'],
 ['Storage warnings','Warn when an account is nearly full.','quota disk space'],
 ['Do not disturb','Silence Cirro notifications.','mute quiet focus'],
 ['Notification sound','Play a sound with Windows notifications.','audio silent'],
 ['Test notification','Send a test desktop notification.','banner alert']]),
 ...entries('startup',[
 ['Launch at login','Open Cirro when you sign in to Windows.','boot auto start autostart'],
 ['Start minimized','Start Cirro in the system tray.','minimise minimize background'],
 ['Restore the last location','Return to your last account, page and folder.','session remember home'],
 ['Keep running in the tray','Continue background work after closing the window.','close quit exit minimize minimise sync']]),
 ...entries('privacy',[
 ['Windows Hello app lock','Protect access to Cirro with Windows Hello.','pin face fingerprint security password'],
 ['Lock after inactivity','Choose when Cirro locks automatically.','timeout idle minutes'],
 ['Store recent file history','Remember opened files or clear their history.','privacy clear recent tracking'],
 ['Lock now','Lock Cirro immediately.','windows hello secure']]),
 ...entries('local',[
 ['Storage on this computer','Measure database, offline, staging and recovery usage.','local disk space cache size'],
 ['Cached thumbnails','Remove thumbnails and fetch them again when needed.','clear cache previews images'],
 ['Finished transfers','Clear completed and cancelled history and staging.','cleanup upload temporary files'],
 ['Database space','Reclaim space after cache cleanup.','sqlite compact vacuum optimize'],
 ['Saved offline files','Review or remove locally saved copies.','download local remove'],
 ['Repair cached listings','Rebuild local Drive metadata.','repair reset refresh database rebuild']]),
 ...entries('support',[
 ['Run diagnostics','Check the database and sync engine.','health integrity sqlite status','Check Cirro on this device'],
 ['Diagnostic report','Review, copy or save a private diagnostic report.','export json help support','Check Cirro on this device'],
 ['App data folder','Open Cirro’s local application data folder.','explorer database location'],
 ['Troubleshooting','Find help with sharing, transfers and offline files.','error connection conflict recovery']]),
 ...entries('about',[
 ['Cirro version','See the installed version of Cirro.','build installed','Cirro'],
 ['Check for updates','Check update availability for this installation.','updater upgrade latest','Updates'],
 ['Release notes','Read what is included in this version.','changelog changes new features']]),
];
export function normalizeSettingText(value:string){return value.normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
export function searchSettings(query:string){const normalized=normalizeSettingText(query);if(!normalized)return [];const tokens=normalized.split(/\s+/).filter(word=>!['settings','setting','the','my','a','an'].includes(word));if(!tokens.length)return [];return settingEntries.map((entry,index)=>{const section=settingsSections.find(section=>section.id===entry.section)!;const title=normalizeSettingText(entry.title);const words=normalizeSettingText(`${entry.title} ${entry.description} ${entry.keywords} ${section.title}`).split(/\s+/);return {entry,index,score:(title===normalized?100:0)+tokens.reduce((score,token)=>score+(title.split(' ').some(word=>word.startsWith(token))?10:1),0),matches:tokens.every(token=>words.some(word=>word.startsWith(token)))};}).filter(result=>result.matches).sort((a,b)=>b.score-a.score||a.index-b.index).map(result=>result.entry);}
