import {expect,it} from 'vitest';
import {trashPermission,trashPermissionMessage} from '../src/filePermissions';
import type {DriveFile} from '../src/data';
const file:DriveFile={id:'owner::file',account:'owner',name:'Report.pdf',type:'pdf',size:'1 MB',modified:'2026-10-31',color:'blue',canTrash:false,canUntrash:true};
it('denies Trash when Google explicitly disallows it',()=>{expect(trashPermission(file)).toBe(false);});
it('uses restore permission instead of trash permission for trashed files',()=>{expect(trashPermission({...file,trashed:true})).toBe(true);expect(trashPermission({...file,trashed:true,canTrash:true,canUntrash:false})).toBe(false);});
it('leaves unknown cached permissions to the live server check',()=>{expect(trashPermission({...file,canTrash:undefined})).toBeUndefined();});
it('identifies the file and account without suggesting reconnecting as a fix',()=>{const message=trashPermissionMessage(file,'work@example.com');expect(message).toContain('work@example.com');expect(message).toContain('Report.pdf');expect(message).toContain('Reconnecting does not change ownership');});
