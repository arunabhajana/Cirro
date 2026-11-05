import {useEffect,useMemo,useRef,useState} from 'react';
import {ChevronRight,Search,X} from 'lucide-react';
import LocalStorageSettings from './LocalStorageSettings';
import SupportSettings from './SupportSettings';
import StorageSettings from './StorageSettings';
import SecuritySettings from './Security';
import StartupSettings from './StartupSettings';
import NotificationSettings from './NotificationSettings';
import FlowSettings from './FlowSettings';
import AccountSettings from './AccountSettings';
import LocalSettings from './LocalSettings';
import AppearanceSettings from './AppearanceSettings';
import AboutSettings from './AboutSettings';
import {searchSettings,settingsSections,type SettingEntry,type SettingsSectionId} from './settingsCatalog';
import type {Appearance} from './theme';

type Props={appearance:Appearance;onAppearance:(value:Appearance)=>void;onSidebar:()=>void;onHome:()=>void;initialSection?:SettingsSectionId};
export default function SettingsPage(props:Props){
 const [category,setCategory]=useState<SettingsSectionId>(props.initialSection||'general');const [query,setQuery]=useState('');const [target,setTarget]=useState('');const panel=useRef<HTMLDivElement>(null);const search=useRef<HTMLInputElement>(null);
 const results=useMemo(()=>searchSettings(query),[query]);const searching=!!query.trim();const section=settingsSections.find(item=>item.id===category)!;
 function navigate(id:SettingsSectionId,entry?:SettingEntry){setCategory(id);setQuery('');setTarget(entry?.target||entry?.title||'');}
 useEffect(()=>{if(!target||searching)return;const frame=requestAnimationFrame(()=>{const heading=Array.from(panel.current?.querySelectorAll<HTMLElement>('h3,h2,strong,.field-label,summary')||[]).find(item=>item.textContent?.trim()===target);if(heading){let ancestor=heading.parentElement;while(ancestor){if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;ancestor=ancestor.parentElement;}}const row=heading?.closest<HTMLElement>('.preference-row,.settings-subsection,.maintenance-intro,.appearance-panel,.flow-heading,.cloud-settings,.about-identity,.release-notes')||heading;if(row){row.tabIndex=-1;row.focus({preventScroll:true});row.scrollIntoView?.({block:'center',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}});return()=>cancelAnimationFrame(frame);},[target,category,searching]);
 function content(){switch(category){
  case 'general':return <><div className="preference-row"><div><h3>Home layout</h3><p>Choose pinned items and dashboard widgets for the current view.</p></div><button className="secondary-button" onClick={props.onHome}>Customize home<ChevronRight size={14}/></button></div><div className="preference-row"><div><h3>Sidebar</h3><p>Arrange navigation, pinned items, spacing and width.</p></div><button className="secondary-button" onClick={props.onSidebar}>Customize sidebar<ChevronRight size={14}/></button></div></>;
  case 'appearance':return <AppearanceSettings value={props.appearance} onChange={props.onAppearance}/>;
  case 'accounts':return <AccountSettings/>;
  case 'files':return <><StorageSettings/><section className="settings-subsection"><h3>Offline files</h3><LocalSettings kind="offline"/></section></>;
  case 'sync':return <FlowSettings/>;
  case 'notifications':return <NotificationSettings/>;
  case 'startup':return <StartupSettings/>;
  case 'privacy':return <SecuritySettings/>;
  case 'local':return <LocalStorageSettings/>;
  case 'support':return <SupportSettings/>;
  case 'about':return <AboutSettings/>;
 }}
 return <div className="settings-page settings-production"><header className="settings-header"><h1>Settings</h1><div className="settings-search-field"><label htmlFor="settings-search-input">Search settings</label><div className="settings-search compound-input"><Search size={17}/><input id="settings-search-input" ref={search} type="search" aria-label="Search settings" aria-controls="settings-content" value={query} onChange={event=>{setQuery(event.target.value);setTarget('');}} onKeyDown={event=>{if(event.key==='Escape'){setQuery('');event.stopPropagation();}if(event.key==='ArrowDown'&&searching){event.preventDefault();panel.current?.querySelector<HTMLButtonElement>('.setting-search-result')?.focus();}}}/>{query&&<button type="button" className="icon-button" aria-label="Clear settings search" onClick={()=>{setQuery('');search.current?.focus();}}><X size={15}/></button>}</div></div></header><div className="settings-shell"><nav className="settings-categories" aria-label="Settings categories">{['Workspace','Device','Help'].map(group=><div className="settings-nav-group" key={group}><span>{group}</span>{settingsSections.filter(item=>item.group===group).map(({id,title,icon:Icon})=><button type="button" key={id} className={!searching&&category===id?'active':''} aria-current={!searching&&category===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={17}/>{title}<ChevronRight size={13}/></button>)}</div>)}</nav><div ref={panel} id="settings-content" className="settings-results">{searching?<section className="settings-search-results" aria-labelledby="settings-results-title"><div className="settings-content-heading"><h2 id="settings-results-title">Search results</h2><p role="status">{results.length} {results.length===1?'setting':'settings'} found</p></div>{results.map(entry=>{const owner=settingsSections.find(item=>item.id===entry.section)!;return <button type="button" className="setting-search-result" key={`${entry.section}:${entry.title}`} onClick={()=>navigate(entry.section,entry)}><span className="setting-search-icon"><owner.icon size={18}/></span><span><small>{owner.title}</small><strong>{entry.title}</strong><span>{entry.description}</span></span><ChevronRight size={17}/></button>;})}{!results.length&&<div className="settings-empty"><Search size={25}/><h3>No matching settings</h3><p>No settings match “{query.trim()}”.</p><button className="secondary-button" onClick={()=>{setQuery('');search.current?.focus();}}>Clear search</button></div>}</section>:<section className="settings-group" aria-labelledby="settings-section-title"><div className="settings-content-heading"><h2 id="settings-section-title">{section.title}</h2><p>{section.description}</p></div>{content()}</section>}</div></div></div>;
}
