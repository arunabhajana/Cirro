import {formatModified} from './formatting';
import {invoke} from './ipc';
import { useEffect, useState, lazy, Suspense } from 'react';
import { Archive, ArrowDownToLine, ChevronRight, ExternalLink, FileSearch, Folder, Info, LoaderCircle, Maximize2, X } from 'lucide-react';
import type { DriveFile } from './data';
import FileGlyph, { describeFile } from './fileTypes';
import { loadPreview, type PreviewContent } from './preview';
import {downloadFile} from './drive';

const PdfPreview=lazy(()=>import('./PdfPreview'));
export type PreviewStatus = 'loading' | 'ready' | 'unavailable';
export function FilePreview({ file, onStatus }: { file: DriveFile; onStatus?: (status:PreviewStatus)=>void }) {
  const info = describeFile(file); const [content, setContent] = useState<PreviewContent | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const media = ['image','video','audio','pdf'].includes(info.kind);
  useEffect(() => { onStatus?.(file.previewLoading ? 'loading' : !file.url || error ? 'unavailable' : media || content ? 'ready' : 'loading'); }, [file.url, file.previewLoading, error, media, content, onStatus]);
  useEffect(() => { const controller = new AbortController(); setContent(null); setError('');
    if (!file.url || media || file.type === 'folder') { setLoading(false); return () => controller.abort(); }
    setLoading(true); loadPreview(file, controller.signal).then(value => { if (!controller.signal.aborted) setContent(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Preview unavailable.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [file.id, file.url, file.name, media]);
  if (file.previewLoading) return <div className="preview-unavailable" role="status"><LoaderCircle className="auth-spinner" size={24}/><p>Fetching preview from Google Drive…</p></div>;
  if (!file.url) return <div className="preview-unavailable"><FileGlyph file={file} large/><strong>{file.type === 'folder' ? 'Folder overview' : 'Preview unavailable'}</strong><p>{file.type === 'folder' ? 'Open this folder to browse its contents.' : file.previewError || 'Open this file in Google Drive to view its contents.'}</p></div>;
  if (info.kind === 'image') return <div className="media-preview"><img src={file.url} alt={file.name} onError={() => setError('Your browser cannot render this image format.')}/>{error && <p role="status">{error}</p>}</div>;
  if (info.kind === 'video') return <div className="media-preview"><video controls preload="metadata" src={file.url} onError={() => setError('This video codec is not supported by your device.')}/>{error && <p role="status">{error}</p>}</div>;
  if (info.kind === 'audio') return <div className="media-preview audio-preview"><FileGlyph file={file} large/><audio controls preload="metadata" src={file.url} onError={() => setError('This audio codec is not supported by your device.')}/>{error && <p role="status">{error}</p>}</div>;
  if (info.kind === 'pdf') return <Suspense fallback={<div className="preview-unavailable" role="status">Loading PDF viewer…</div>}><PdfPreview url={file.url} onError={setError}/></Suspense>;
  if (loading) return <div className="preview-unavailable" role="status"><LoaderCircle className="auth-spinner" size={24}/><p>Preparing preview…</p></div>;
  if (error) return <div className="preview-unavailable" role="status"><FileSearch size={30}/><strong>Preview unavailable</strong><p>{error}</p></div>;
  if (!content) return null;
  return <div className="document-preview">{content.note && <p className="preview-caption">{content.note}</p>}{content.kind === 'text' ? <pre>{content.text}</pre> : content.kind === 'table' ? <div className="sheet-preview"><table><tbody>{content.rows.map((row, index) => <tr key={index}><th>{index + 1}</th>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div> : <><div className="archive-summary"><Archive size={16}/>{content.entries.length} entries · read only</div><ul className="archive-entries">{content.entries.map((entry, index) => <li key={index}>{entry.directory ? <Folder size={15}/> : <FileSearch size={15}/>}<span title={entry.name}>{entry.name}</span><small>{entry.directory ? 'Folder' : `${(entry.size / 1024).toFixed(1)} KB`}</small></li>)}</ul>{!content.entries.length && <p className="preview-caption">This archive is empty.</p>}</>}</div>;
}

export default function FileInspector({ file, files, onClose, onOpen }: { file: DriveFile; files: DriveFile[]; onClose: () => void; onOpen: (file: DriveFile) => void }) {
  const info = describeFile(file); const children = files.filter(item => item.parent === file.id && !item.trashed);
  return <aside className="file-inspector" aria-label="File inspector"><div className="inspector-heading"><span><Info size={16}/>File details</span><button className="icon-button" aria-label="Close file inspector" onClick={onClose}><X size={18}/></button></div><div className="inspector-scroll"><div className="inspector-identity"><FileGlyph file={file} large/><h2>{file.name}</h2><p>{info.label}</p></div><div className="inspector-actions">{file.remote && <button className="secondary-button" onClick={()=>void invoke('drive_open',{id:file.id}).catch(error=>window.alert(String(error)))}><ExternalLink size={14}/>Open in Drive</button>}<button className="secondary-button" onClick={() => onOpen(file)}><Maximize2 size={14}/>{file.type === 'folder' ? 'Open folder' : 'Quick Look'}</button>{file.remote && !file.url && <button className="secondary-button" onClick={()=>void downloadFile(file).catch(error=>window.alert(String(error)))}><ArrowDownToLine size={14}/>Download</button>}{file.url && <a className="secondary-button" href={file.url} download={file.name}><ArrowDownToLine size={14}/>Download</a>}</div>{file.type === 'folder' && children.length > 0 && <section className="inspector-children"><h3>Contents <span>{children.length}</span></h3>{children.slice(0, 8).map(child => <button key={child.id} onClick={() => onOpen(child)}><FileGlyph file={child}/><span>{child.name}</span><ChevronRight size={13}/></button>)}</section>}<FileInformation file={file} files={files}/></div></aside>;
}

export function FileInformation({ file, files }: { file:DriveFile; files:DriveFile[] }) { const info=describeFile(file); return <section className="inspector-properties"><h3>Information</h3><dl><div><dt>Kind</dt><dd>{info.label}</dd></div><div><dt>Size</dt><dd>{file.size}</dd></div><div><dt>Modified</dt><dd>{formatModified(file.modified)}</dd></div><div><dt>Location</dt><dd>{files.find(item => item.id === file.parent)?.name || 'All files'}</dd></div><div><dt>Source</dt><dd>{file.url ? 'Local file · current session' : file.remote ? 'Google Drive' : 'Local workspace'}</dd></div></dl></section>; }
