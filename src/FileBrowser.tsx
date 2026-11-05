import {removableShare} from './sharedView';
import {formatModified,modifiedParts} from './formatting';
import {useAuth} from './auth';
import {useDevicePreference} from './devicePreferences';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Folder, Grid2X2, LayoutList, MoreHorizontal, Pin, Search, Star, Trash2, X } from 'lucide-react';
import type { DriveFile } from './data';
import { accounts } from './data';
import FileInspector from './FileInspector';
import { ancestors, type Page } from './workspace';

type Props = {
  items: DriveFile[]; files: DriveFile[]; page: Page; folder: string | null; query: string; scope: string;
  canBack: boolean; canForward: boolean; back: () => void; forward: () => void; up: () => void;
  onFolder: (id: string | null) => void; onOpen: (file: DriveFile) => void;
  onContext: (event: MouseEvent, file?: DriveFile, selection?: DriveFile[]) => void;
  onBulk: (action: 'star' | 'pin' | 'trash', files: DriveFile[]) => void;
  onRename: (file: DriveFile) => void; onCopy: (files: DriveFile[], cut: boolean) => void; onPaste: () => void;
  renderIcon: (file: DriveFile, large?: boolean) => ReactNode;
};

function bytes(size: string) { const value = parseFloat(size) || 0; const units = ['B', 'KB', 'MB', 'GB', 'TB']; return value * 1000 ** Math.max(0, units.indexOf(size.split(' ').pop()!)); }
function modified(value: string) { if (value === 'Just now') return Date.now(); const relative = value.match(/(\d+)\s+(minute|hour)/); if (relative) return Date.now() - +relative[1] * (relative[2] === 'hour' ? 3600000 : 60000); if (value === 'Today') return Date.now() - 4 * 3600000; if (value === 'Yesterday') return Date.now() - 86400000; return Date.parse(value) || 0; }

export default function FileBrowser(props: Props) {
  const {user}=useAuth();
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const inspected = props.items.find(file => file.id === inspectedId);
  const [view,setView]=useDevicePreference<'list'|'grid'>('device:fileView','list','fileView');
  const [sort, setSort] = useState('name'); const [descending, setDescending] = useState(false);
  const [pageIndex,setPageIndex]=useState(0); const [pageSize,setPageSize]=useDevicePreference<number>('device:pageSize',12,'pageSize');
  const [selected, setSelected] = useState<string[]>([]);
  const key = `${props.page}:${props.folder}:${props.scope}:${props.query}`;
  useEffect(() => { setPageIndex(0); setSelected([]);  setInspectedId(null); }, [key]);


  const ordered = [...props.items].sort((a, b) => {
    if (!props.query && a.type !== b.type && (a.type === 'folder' || b.type === 'folder')) return a.type === 'folder' ? -1 : 1;
    const result = sort === 'size' ? bytes(a.size) - bytes(b.size) : sort === 'modified' ? modified(a.modified) - modified(b.modified) : sort === 'account' ? (accounts.find(account=>account.id===a.account)?.name||a.account).localeCompare(accounts.find(account=>account.id===b.account)?.name||b.account) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return descending ? -result : result;
  });
  const pages = Math.max(1, Math.ceil(ordered.length / pageSize)); const activePage = Math.min(pageIndex, pages - 1);
  const visible = ordered.slice(activePage * pageSize, (activePage + 1) * pageSize);
  const selection = ordered.filter(file => selected.includes(file.id));
  const allChecked = visible.length > 0 && visible.every(file => selected.includes(file.id));
  function select(file: DriveFile, _event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    setInspectedId(file.id);
  }
  function context(event: MouseEvent, file: DriveFile) {
    event.stopPropagation();

    props.onContext(event, file, selected.includes(file.id) ? selection : [file]);
  }
  function column(label: string, value: string) { return <button onClick={() => { if (sort === value) setDescending(!descending); else { setSort(value); setDescending(value === 'modified'); } setPageIndex(0); }}>{label}{sort === value && <ArrowDown size={12} style={{ transform: descending ? 'rotate(180deg)' : undefined }}/>}</button>; }
  const path = ancestors(props.folder, props.files);
  return <div className={`file-browser-split ${inspected ? 'with-inspector' : ''}`}><section className="manager" aria-label="File browser" onContextMenu={event => props.onContext(event)} onKeyDown={event => {
    if ((event.target as HTMLElement).closest('input:not([type="checkbox"]), select, textarea, [role="menu"]')) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(ordered.map(file => file.id)); }
    else if (mod && ['c', 'x'].includes(event.key.toLowerCase()) && selection.length) { event.preventDefault(); props.onCopy(selection, event.key.toLowerCase() === 'x'); }
    else if (mod && event.key.toLowerCase() === 'v') { event.preventDefault(); props.onPaste(); }
    else if (event.key === 'F2' && selection.length === 1) { event.preventDefault(); props.onRename(selection[0]); }
    else if (event.key === 'Delete' && selection.length) { event.preventDefault(); props.onBulk('trash', selection); setSelected([]); }
    else if (event.key === 'Escape') { setSelected([]); setInspectedId(null); }
    else if (event.key === ' ' && (event.target as HTMLElement).dataset.fileRow && inspected) { event.preventDefault(); props.onOpen(inspected); }
    else if (event.key === 'Enter' && (event.target as HTMLElement).dataset.fileRow && inspected) props.onOpen(inspected);
    else if (['ArrowDown', 'ArrowUp'].includes(event.key) && (event.target as HTMLElement).dataset.fileRow) {
      event.preventDefault(); const index = visible.findIndex(file => file.id === inspectedId);
      const next = visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) { select(next, event); document.querySelector<HTMLElement>(`[data-file-id="${next.id}"]`)?.focus(); }
    }
  }}>
    <div className="manager-toolbar"><div className="history-controls"><button className="icon-button" title="Back" aria-label="Back" disabled={!props.canBack} onClick={props.back}><ArrowLeft size={17}/></button><button className="icon-button" title="Forward" aria-label="Forward" disabled={!props.canForward} onClick={props.forward}><ArrowRight size={17}/></button><button className="icon-button" title="Parent folder" aria-label="Parent folder" disabled={!props.folder} onClick={props.up}><ArrowUp size={17}/></button></div>
      <nav className="folder-breadcrumbs" aria-label="Folder path"><button onClick={() => props.onFolder(null)}><Folder size={15}/>{props.query ? 'Search results' : props.page === 'My files' ? 'All files' : props.page}</button>{path.map(file => <span key={file.id}><ChevronRight size={13}/><button onClick={() => props.onFolder(file.id)}>{file.name}</button></span>)}</nav>
      <div className="view-toggle"><button aria-label="List view" title="List view" aria-pressed={view === 'list'} className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}><LayoutList size={17}/></button><button aria-label="Grid view" title="Grid view" aria-pressed={view === 'grid'} className={view === 'grid' ? 'selected' : ''} onClick={() => setView('grid')}><Grid2X2 size={17}/></button></div>
    </div>
    {selection.length > 0 && <div className="selection-toolbar"><span><Check size={14}/>{selection.length} selected</span><button onClick={() => props.onBulk('star', selection)}><Star size={14}/>Star</button><button onClick={() => { props.onBulk('trash', selection); setSelected([]); }}><Trash2 size={14}/>{props.page === 'Trash' ? 'Restore' : selection.every(file=>removableShare(file,props.files))?'Remove from view':'Move to trash / remove'}</button><button className="icon-button" aria-label="Clear selection" onClick={() => setSelected([])}><X size={15}/></button></div>}
    <div className={`manager-content ${view === 'grid' ? 'manager-grid' : ''}`}>
      {view === 'list' ? <table className="manager-table"><thead><tr><th className="selection-cell"><input type="checkbox" aria-label="Select this page" checked={allChecked} ref={element => { if (element) element.indeterminate = !allChecked && visible.some(file => selected.includes(file.id)); }} onChange={() => setSelected(old => allChecked ? old.filter(id => !visible.some(file => file.id === id)) : [...new Set([...old, ...visible.map(file => file.id)])])}/></th><th aria-sort={sort === 'name' ? descending ? 'descending' : 'ascending' : 'none'}>{column('Name', 'name')}</th><th>{column('Account', 'account')}</th><th>{column('Modified', 'modified')}</th><th>{column('Size', 'size')}</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map(file => <tr key={file.id} data-file-row="true" data-file-id={file.id} tabIndex={0} aria-selected={selected.includes(file.id)} className={selected.includes(file.id) ? 'selected' : ''} onClick={event => select(file, event)} onDoubleClick={() => props.onOpen(file)} onContextMenu={event => context(event, file)}><td className="selection-cell"><input type="checkbox" aria-label={`Select ${file.name}`} checked={selected.includes(file.id)} onClick={event => event.stopPropagation()} onChange={() => { setSelected(old => old.includes(file.id) ? old.filter(id => id !== file.id) : [...old, file.id]);  }}/></td><td><div className="manager-file-name">{props.renderIcon(file)}<button title={file.name} onClick={event => { event.stopPropagation(); select(file, event); event.currentTarget.closest<HTMLElement>('[data-file-row]')?.focus(); }}>{file.name}</button>{file.offline && <span className="offline-badge" title={file.offlinePartial?"Some items require internet or were removed from the offline copy":"Available offline"}>{file.offlinePartial?"Partly offline":"Offline"}</span>}{file.starred && <Star size={12} className="starred-icon"/>}</div></td><td><span className={`account-tag ${file.account}`} style={{color:accounts.find(account=>account.id===file.account)?.color}}><span/>{accounts.find(account => account.id === file.account)!.name}</span></td><td className="manager-date" title={formatModified(file.modified)}><span>{modifiedParts(file.modified).date}</span><small>{modifiedParts(file.modified).time}</small></td><td className="manager-size">{file.size}</td><td><button className="icon-button" aria-label={`Actions for ${file.name}`} onClick={event => context(event, file)}><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table> : visible.map(file => <article className={`manager-tile ${selected.includes(file.id) ? 'selected' : ''}`} key={file.id} data-file-row="true" data-file-id={file.id} tabIndex={0} aria-label={file.name} onClick={event => select(file, event)} onDoubleClick={() => props.onOpen(file)} onContextMenu={event => context(event, file)}><div className="tile-top"><input type="checkbox" aria-label={`Select ${file.name}`} checked={selected.includes(file.id)} onClick={event => event.stopPropagation()} onChange={() => setSelected(old => old.includes(file.id) ? old.filter(id => id !== file.id) : [...old, file.id])}/><button className="icon-button" aria-label={`Actions for ${file.name}`} onClick={event => context(event, file)}><MoreHorizontal size={18}/></button></div><button className="tile-open" onClick={event => { event.stopPropagation(); select(file, event); event.currentTarget.closest<HTMLElement>('[data-file-row]')?.focus(); }}>{props.renderIcon(file, true)}<strong>{file.name}</strong></button><span className={`account-tag ${file.account}`} style={{color:accounts.find(account=>account.id===file.account)?.color}}><span/>{accounts.find(account => account.id === file.account)!.name}</span><small>{file.size} · {formatModified(file.modified)}</small></article>)}
      {!visible.length && <div className="empty-state">{props.query ? <Search size={35}/> : <Folder size={35}/>}<h3>{props.query ? 'No matching files' : 'This folder is empty'}</h3><p>{props.query ? 'Try a different file name or search another account.' : 'Use New to upload files or create a folder.'}</p></div>}
    </div>
    <footer className="pagination"><span>{ordered.length ? activePage * pageSize + 1 : 0}–{Math.min((activePage + 1) * pageSize, ordered.length)} of {ordered.length} items{selection.length > 0 && ` · ${selection.length} selected`}</span><label>Per page<select aria-label="Items per page" value={pageSize} onChange={event => { setPageSize(+event.target.value); setPageIndex(0); }}>{[6, 12, 24, 48].map(size => <option key={size}>{size}</option>)}</select></label><div><button className="icon-button" aria-label="First page" disabled={activePage === 0} onClick={() => setPageIndex(0)}><ChevronsLeft size={15}/></button><button className="icon-button" aria-label="Previous page" disabled={activePage === 0} onClick={() => setPageIndex(activePage - 1)}><ChevronLeft size={16}/></button><span>{activePage + 1} / {pages}</span><button className="icon-button" aria-label="Next page" disabled={activePage === pages - 1} onClick={() => setPageIndex(activePage + 1)}><ChevronRight size={16}/></button><button className="icon-button" aria-label="Last page" disabled={activePage === pages - 1} onClick={() => setPageIndex(pages - 1)}><ChevronsRight size={15}/></button></div></footer>
  </section>{inspected && <FileInspector key={inspected.id} file={inspected} files={props.files} onClose={() => setInspectedId(null)} onOpen={props.onOpen}/>}</div>;
}
