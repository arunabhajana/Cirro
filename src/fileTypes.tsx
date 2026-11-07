import {remoteContent} from './driveContent';
import {useEffect,useState} from 'react';
import {Folder,FolderOpen,FolderCode,FolderClosed,FolderOpenDot,FolderHeart,FolderArchive} from 'lucide-react';
import type {DriveFile} from './data';
import {folderStyles} from './folderStyles';
import {describeFile} from './shared/fileDescription';
export {describeFile,type FileKind} from './shared/fileDescription';
export default function FileGlyph({ file, large = false }: { file: DriveFile; large?: boolean }) {
  const [thumbnail,setThumbnail]=useState('');
  useEffect(()=>{let active=true;let objectUrl='';if(file.remote&&file.thumbnail&&file.type!=='folder')remoteContent(file,true).then(result=>{objectUrl=result.url;if(active)setThumbnail(result.url);else URL.revokeObjectURL(result.url);}).catch(()=>{});return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[file.id,file.modified,file.thumbnail]);
  const info = describeFile(file); const folder = info.kind === 'folder'; const name = file.name.toLowerCase();
  const Icon = folder ? /photo|image|picture/.test(name) ? FolderOpen : /project|code|source/.test(name) ? FolderCode : /music|audio/.test(name) ? FolderClosed : /video|movie/.test(name) ? FolderOpenDot : /personal/.test(name) ? FolderHeart : /archive|backup/.test(name) ? FolderArchive : Folder : info.icon;
  const Decoration = folder && file.folderStyle && file.folderStyle !== 'default' ? folderStyles.find(style=>style.id===file.folderStyle)?.icon : null;
  return <span className={`file-glyph ${folder ? file.color : info.color} ${folder ? 'folder-glyph' : ''} ${large ? 'large' : ''}`} aria-hidden="true">{thumbnail && <img className="drive-thumbnail" src={thumbnail} alt=""/>}{folder && file.folderStyle ? <Folder strokeWidth={1.6}/> : <Icon strokeWidth={1.6}/>} {Decoration && <Decoration className="folder-decoration" strokeWidth={1.8}/>} {!folder && <small>{info.extension.slice(0, 5).toUpperCase() || info.kind.toUpperCase()}</small>}</span>;
}
