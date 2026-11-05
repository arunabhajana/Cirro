import {checkForUpdates} from './Updates';
import {RefreshCw,Check} from 'lucide-react';
import {version} from '../package.json';
import {BrandLogo} from './branding';
export const releaseNotes=[
 {title:'Your workspace',items:['Connect multiple Google accounts and browse them together or separately.','Customize each Home view with pinned files, folders and rearrangeable widgets.']},
 {title:'Files and sync',items:['Queue uploads, downloads, moves and copies with retry controls.','Manage sharing, preview files and keep files or folders offline.','Sync computer folders with Cirro Flow and restore recovery copies.']},
 {title:'Control and privacy',items:['Protect Cirro with Windows Hello and configure startup, tray and notifications.','Manage local storage and export diagnostic reports without account identities or file contents.']},
];
export default function AboutSettings(){
 return <div className="about-settings"><div className="about-identity"><BrandLogo/><div><h3>Cirro</h3><p>Version {version}</p></div></div><div className="preference-row"><div><h3>Updates</h3><p>Check for a newer version of Cirro.</p></div><button className="secondary-button" onClick={()=>void checkForUpdates()}><RefreshCw size={15}/>Check for updates</button></div><section className="release-notes" aria-labelledby="release-notes-title"><div className="release-notes-heading"><h3 id="release-notes-title">Release notes</h3><span><Check size={13}/>Version {version}</span></div>{releaseNotes.map(group=><details className="release-note-group" key={group.title}><summary>{group.title}</summary><ul>{group.items.map(item=><li key={item}>{item}</li>)}</ul></details>)}<p className="settings-note">Cirro Cloud remains a preview feature. Review its limitations before enabling a cloud view.</p></section></div>;
}
