import {expect,it} from 'vitest';
import type {DriveFile} from '../src/data';
import {removableShare,removedFromSharedView} from '../src/sharedView';
const folder:DriveFile={id:'one::folder',name:'Shared folder',account:'one',type:'folder',size:'0 B',modified:'',color:'blue',shared:true,canTrash:false};
const child:DriveFile={...folder,id:'one::file',name:'File',type:'pdf',shared:false,parent:folder.id};
it('offers view removal for an incoming share without Trash permission',()=>{expect(removableShare(folder,[folder])).toBe(true);expect(removableShare({...folder,canTrash:undefined},[folder])).toBe(true);expect(removableShare({...folder,canTrash:true},[folder])).toBe(false);});
it('inherits the shared context of parent folders',()=>{expect(removableShare(child,[folder,child])).toBe(true);expect(removedFromSharedView(child,[folder,child],[folder.id])).toBe(true);});
it('namespaced view removals do not affect another account viewing the same file',()=>{const other={...folder,id:'two::folder',account:'two'};expect(removedFromSharedView(other,[folder,other],[folder.id])).toBe(false);});
it('does not treat own files or trashed items as removable shares',()=>{expect(removableShare({...folder,shared:false},[])).toBe(false);expect(removableShare({...folder,trashed:true},[folder])).toBe(false);});
