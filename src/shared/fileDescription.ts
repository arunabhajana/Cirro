import { Archive, AudioLines, Blocks, CalendarDays, Code2, Contact, Database, File, FileImage, FileKey2, FileSpreadsheet, FileText, Film, Folder, FolderCode, FolderOpen, FolderClosed, FolderOpenDot, FolderHeart, FolderArchive, Globe, ListChecks, Mail, Presentation, Type, PenTool, FileSymlink, type LucideIcon } from 'lucide-react';
import type {DriveFile} from '../data';
export type FileKind = 'folder' | 'pdf' | 'sheet' | 'image' | 'video' | 'doc' | 'audio' | 'code' | 'archive' | 'slides' | 'text' | 'design' | 'font' | 'model' | 'database' | 'mail' | 'calendar' | 'contact' | 'executable' | 'unknown';
type Description = { kind: FileKind; label: string; icon: LucideIcon; color: string; extension: string };
const groups: { kind: FileKind; extensions: string[]; label: string; icon: LucideIcon; color: string }[] = [
  { kind:'pdf', extensions:['pdf'], label:'PDF document', icon:FileText, color:'coral' },
  { kind:'archive', extensions:['zip','zipx','rar','7z','tar','gz','tgz','bz2','xz','zst','cab','iso','dmg'], label:'Archive', icon:Archive, color:'amber' },
  { kind:'sheet', extensions:['xlsx','xls','xlsm','xlsb','csv','tsv','ods','gsheet','numbers'], label:'Spreadsheet', icon:FileSpreadsheet, color:'mint' },
  { kind:'slides', extensions:['ppt','pptx','pptm','odp','gslides','key'], label:'Presentation', icon:Presentation, color:'amber' },
  { kind:'image', extensions:['jpg','jpeg','png','gif','webp','avif','bmp','ico','svg','tif','tiff','heic','heif','raw','cr2','nef','dng','psd','ai','eps'], label:'Image', icon:FileImage, color:'pink' },
  { kind:'video', extensions:['mp4','webm','mov','m4v','mkv','avi','mpeg','mpg','wmv','flv','3gp','mts','m2ts','vob'], label:'Video', icon:Film, color:'purple' },
  { kind:'audio', extensions:['mp3','wav','ogg','oga','opus','flac','aac','m4a','aiff','aif','wma','mid','midi'], label:'Audio', icon:AudioLines, color:'coral' },
  { kind:'doc', extensions:['doc','docx','docm','odt','rtf','gdoc','pages','epub'], label:'Document', icon:FileText, color:'blue' },
  { kind:'code', extensions:['js','jsx','ts','tsx','mjs','cjs','json','jsonl','html','htm','css','scss','sass','less','xml','yaml','yml','toml','ini','py','rs','go','java','kt','swift','c','cpp','h','cs','php','rb','sh','bat','ps1','vue','svelte','sql','ipynb','env','gitignore','dockerfile'], label:'Source code', icon:Code2, color:'mint' },
  { kind:'text', extensions:['txt','md','mdx','log','rst','tex','srt','vtt'], label:'Text file', icon:FileText, color:'blue' },
  { kind:'design', extensions:['fig','sketch','xd','indd','afdesign','drawio','gdraw'], label:'Design file', icon:PenTool, color:'purple' },
  { kind:'font', extensions:['ttf','otf','woff','woff2'], label:'Font', icon:Type, color:'purple' },
  { kind:'model', extensions:['obj','stl','fbx','blend','gltf','glb','3ds','dwg','dxf','step'], label:'3D / CAD file', icon:Blocks, color:'mint' },
  { kind:'database', extensions:['db','sqlite','sqlite3','mdb','accdb','parquet'], label:'Database', icon:Database, color:'amber' },
  { kind:'mail', extensions:['eml','msg','mbox'], label:'Email', icon:Mail, color:'blue' },
  { kind:'calendar', extensions:['ics','ical'], label:'Calendar', icon:CalendarDays, color:'coral' },
  { kind:'contact', extensions:['vcf','vcard'], label:'Contact', icon:Contact, color:'blue' },
  { kind:'executable', extensions:['exe','msi','app','apk','deb','rpm','dll','wasm','bin'], label:'Application / binary', icon:FileKey2, color:'gray' },
];
export function describeFile(file: Pick<DriveFile, 'name' | 'type'> & { mimeType?: string }): Description {
  const extension = (file.name.includes('.') ? file.name.split('.').pop()! : file.name).toLowerCase();
  if (file.type === 'folder' || file.mimeType === 'application/vnd.google-apps.folder') return { kind:'folder', label:'Folder', icon:Folder, color:'blue', extension:'' };
  const google = file.mimeType?.replace('application/vnd.google-apps.', '');
  if (google === 'form' || extension === 'gform') return { kind:'unknown', label:'Google Form', icon:ListChecks, color:'purple', extension:'FORM' };
  if (google === 'site' || extension === 'gsite') return { kind:'unknown', label:'Google Site', icon:Globe, color:'blue', extension:'SITE' };
  if (google === 'shortcut' || extension === 'lnk' || extension === 'url') return { kind:'unknown', label:'Shortcut', icon:FileSymlink, color:'blue', extension:'LINK' };
  const kind = google === 'document' ? 'doc' : google === 'spreadsheet' ? 'sheet' : google === 'presentation' ? 'slides' : google === 'drawing' ? 'design' : undefined;
  const found = groups.find(group => group.extensions.includes(extension)) || groups.find(group => group.kind === kind) || (file.mimeType?.startsWith('image/') ? groups.find(group => group.kind === 'image') : file.mimeType?.startsWith('audio/') ? groups.find(group => group.kind === 'audio') : file.mimeType?.startsWith('video/') ? groups.find(group => group.kind === 'video') : undefined);
  return found ? { ...found, extension } : { kind:'unknown', label:extension ? `${extension.toUpperCase()} file` : 'File', icon:File, color:'gray', extension };
}
