import { Folder, FileText, Image, Code2, Video, Heart, Music2, Archive } from 'lucide-react';
export const folderStyles = [
  { id:'default', label:'Folder', icon:Folder }, { id:'documents', label:'Documents', icon:FileText },
  { id:'photos', label:'Photos', icon:Image }, { id:'projects', label:'Projects', icon:Code2 },
  { id:'videos', label:'Videos', icon:Video }, { id:'personal', label:'Personal', icon:Heart },
  { id:'music', label:'Music', icon:Music2 }, { id:'archive', label:'Archive', icon:Archive },
] as const;
export type FolderStyle = typeof folderStyles[number]['id'];
export const folderColors = [{id:'blue',label:'Blue'}, {id:'mint',label:'Mint'}, {id:'pink',label:'Pink'}, {id:'purple',label:'Purple'}, {id:'amber',label:'Amber'}, {id:'coral',label:'Coral'}];
