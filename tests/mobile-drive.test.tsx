import { expect, it, vi } from 'vitest';
import { DriveClient } from '../src/platforms/android/drive/client';
import { DriveConsentRequired } from '../src/platforms/android/auth/nativeGoogle';
import { FOLDER, mapSnapshot, type RemoteFile, type Snapshot } from '../src/platforms/android/drive/model';

const raw=(id:string,extra:Partial<RemoteFile>={}):RemoteFile=>({id,name:id,mimeType:'application/pdf',parents:['root'],...extra});
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function api(handler:(url:URL,init?:RequestInit)=>Response|Promise<Response>) {
  const fetcher=vi.fn((input:RequestInfo|URL,init?:RequestInit)=>Promise.resolve(handler(new URL(String(input)),init)));
  const tokens=vi.fn(async(account:string)=>'token-for-'+account);
  return {client:new DriveClient(tokens,fetcher as typeof fetch),fetcher,tokens};
}
function baseline(url:URL) {
  if(url.pathname.endsWith('/files/root'))return json({id:'root'});
  if(url.pathname.endsWith('/about'))return json({storageQuota:{usage:'9000000000',limit:'15000000000'}});
  if(url.pathname.endsWith('/drives'))return json({drives:[]});
  if(url.pathname.endsWith('/changes/startPageToken'))return json({startPageToken:'before'});
  if(url.pathname.endsWith('/changes'))return json({changes:[],newStartPageToken:'after'});
  return undefined;
}
it('pages all files and shared drives, expands incoming folders, and replays changes during enumeration',async()=>{
  const {client,fetcher}=api(url=>{
    if(url.pathname.endsWith('/drives'))return json({drives:[{id:'team',name:'Team'}]});
    if(url.pathname.endsWith('/files')) {
      if(url.searchParams.get('driveId')==='team')return json({files:[raw('team-file',{parents:['team'],driveId:'team'})]});
      if(url.searchParams.get('q'))return json({files:[raw('shared-child',{parents:['incoming']})]});
      return url.searchParams.get('pageToken')==='page2'?json({files:[raw('incoming',{mimeType:FOLDER,parents:[],sharedWithMeTime:'2026-01-01'}),raw('trash',{trashed:true})]}):json({files:[raw('doc'),raw('folder',{mimeType:FOLDER})],nextPageToken:'page2'});
    }
    if(url.pathname.endsWith('/changes'))return json({changes:url.searchParams.has('driveId')?[]:[{fileId:'doc',file:raw('doc',{name:'Changed during scan'})}],newStartPageToken:'after'});
    return baseline(url)!;
  });
  const snapshot=await client.sync('account-a');
  const mapped=mapSnapshot(snapshot);
  expect(snapshot.files.find(file=>file.id==='doc')?.name).toBe('Changed during scan');
  expect(mapped.find(file=>file.rawId==='shared-child')?.shared).toBe(true);
  expect(mapped.find(file=>file.rawId==='shared-child')?.parent).toBe('account-a:incoming');
  expect(mapped.find(file=>file.rawId==='trash')?.trashed).toBe(true);
  expect(mapped.find(file=>file.rawId==='team')?.sharedDriveRoot).toBe(true);
  expect(mapped.find(file=>file.rawId==='team-file')?.inMyDrive).toBe(true);
  expect(snapshot.quota).toEqual({used:9000000000,total:15000000000});
  expect(fetcher.mock.calls.every(([,init])=>(init?.headers as Record<string,string>).Authorization==='Bearer token-for-account-a')).toBe(true);
  expect(snapshot.tokens).toEqual({user:'after',team:'after'});
});
it('applies all change pages including deletions and inherited shared descendants',async()=>{
  const previous:Snapshot={account:'a',root:'root',drives:[],files:[raw('parent',{mimeType:FOLDER,sharedWithMeTime:'yesterday'}),raw('inherited',{parents:['parent']}),raw('independent',{parents:['parent'],sharedWithMeTime:'yesterday'}),raw('doc')],quota:{used:0,total:null},syncedAt:new Date().toISOString(),tokens:{user:'old'}};
  const {client,fetcher}=api(url=>{
    if(url.pathname.endsWith('/changes'))return url.searchParams.get('pageToken')==='old'?json({changes:[{fileId:'parent',removed:true}],nextPageToken:'next'}):json({changes:[{fileId:'doc',file:raw('doc',{starred:true,trashed:true})}],newStartPageToken:'new'});
    if(url.pathname.endsWith('/files'))throw new Error('Unexpected full rescan');
    return baseline(url)!;
  });
  const snapshot=await client.sync('a',previous);
  expect(snapshot.files.map(file=>file.id)).toEqual(['independent','doc']);
  expect(snapshot.files.find(file=>file.id==='doc')?.starred).toBe(true);
  expect(snapshot.tokens?.user).toBe('new');
  expect(fetcher.mock.calls.filter(([input])=>String(input).includes('/changes?'))).toHaveLength(2);
});
it('rebuilds after an expired cursor without clearing the previous snapshot on errors',async()=>{
  const previous:Snapshot={account:'a',root:'root',drives:[],files:[raw('old')],quota:{used:0,total:null},syncedAt:new Date().toISOString(),tokens:{user:'expired'}};
  const {client}=api(url=>{
    if(url.pathname.endsWith('/changes') && url.searchParams.get('pageToken')==='expired')return json({error:{message:'Expired'}},410);
    if(url.pathname.endsWith('/files'))return json({files:[raw('new')]});
    return baseline(url)!;
  });
  expect((await client.sync('a',previous)).files[0].id).toBe('new');
  const broken=api(url=>url.pathname.endsWith('/files')?json({files:[raw('partial')],incompleteSearch:true}):baseline(url)!).client;
  await expect(broken.sync('a')).rejects.toThrow('incomplete');
  expect(previous.files[0].id).toBe('old');
});
it('does not confuse a shared outgoing item with Shared with me, and scopes identical raw IDs per account',()=>{
  const snap:Snapshot={account:'a',root:'root',drives:[],files:[raw('same',{starred:true}),raw('deleted-folder',{mimeType:FOLDER,trashed:true}),raw('child',{parents:['deleted-folder']})],quota:{used:0,total:null},syncedAt:''};
  const a=mapSnapshot(snap),b=mapSnapshot({...snap,account:'b'});
  expect(a[0].shared).toBe(false);expect(a[0].inMyDrive).toBe(true);expect(a[0].id).not.toBe(b[0].id);
  expect(a.find(file=>file.rawId==='child')?.trashed).toBe(true);
});
it('requires fresh consent for insufficient scopes and keeps mutations account-scoped',async()=>{
  const {client}=api(()=>json({error:{message:'Insufficient scopes',errors:[{reason:'insufficientPermissions'}]}},403));
  await expect(client.sync('a')).rejects.toBeInstanceOf(DriveConsentRequired);
  const working=api((url,init)=>{expect(url.pathname).toContain('files/shared-id');expect(init?.method).toBe('PATCH');expect(init?.body).toBe('{"trashed":false}');return json(raw('shared-id'));});
  await working.client.update('owner-b','shared-id',{trashed:false});
  expect(working.tokens).toHaveBeenCalledWith('owner-b');
});
it('rejects repeated listing tokens rather than returning a truncated success',async()=>{
  const {client}=api(url=>url.pathname.endsWith('/files')?json({files:[],nextPageToken:'loop'}):baseline(url)!);
  await expect(client.sync('a')).rejects.toThrow('repeated page token');
});
