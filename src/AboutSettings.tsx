import SettingsDisclosure from './SettingsDisclosure';
import {checkForUpdates} from './Updates';
import {RefreshCw} from 'lucide-react';
import {version} from '../package.json';
import {BrandLogo} from './branding';
import {releaseNotes,milestoneVersion,releaseTitle,releaseSummary} from './releaseContent';
export {releaseNotes} from './releaseContent';
export default function AboutSettings(){
 return <div className="about-settings">
  <div className="about-identity"><BrandLogo/><div><h3>Cirro</h3><p>Version {version}</p></div></div>
  <div className="preference-row"><div><h3>Updates</h3><p>Check for a newer version of Cirro.</p></div><button className="secondary-button" onClick={()=>void checkForUpdates()}><RefreshCw size={15}/>Check for updates</button></div>
  <section className="release-notes" aria-labelledby="release-notes-title">
   <h3 id="release-notes-title">Release notes</h3>
   <SettingsDisclosure className="release-entry" title={<span><strong>{releaseTitle}</strong><small>Version {milestoneVersion}</small></span>}>
    <div className="release-entry-body">
     <p className="release-overview">{releaseSummary}</p>
     {releaseNotes.map(group=><section className="release-category" key={group.title} aria-label={group.title}><h4>{group.title}</h4><dl>{group.items.map(item=><div key={item.title}><dt>{item.title}</dt><dd>{item.description}</dd></div>)}</dl></section>)}
    </div>
   </SettingsDisclosure>
  </section>
 </div>;
}
