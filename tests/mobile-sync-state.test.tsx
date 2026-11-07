import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Snapshot } from '../src/platforms/android/drive/model';
const mocks=vi.hoisted(()=>({sync:vi.fn(),update:vi.fn(),createFolder:vi.fn(),read:vi.fn(),save:vi.fn(),clear:vi.fn(),token:vi.fn(),Consent:class extends Error{}}));
vi.mock('../src/platforms/android/drive/client',()=>({mobileDriveClient:{sync:mocks.sync,update:mocks.update,createFolder:mocks.createFolder}}));
vi.mock('../src/platforms/android/drive/cache',()=>({readSnapshot:mocks.read,saveSnapshot:mocks.save,clearSnapshots:mocks.clear}));
vi.mock('../src/platforms/android/auth/nativeGoogle',()=>({DriveConsentRequired:mocks.Consent,driveAccessToken:mocks.token}));
import { useMobileDrive } from '../src/platforms/android/drive/useMobileDrive';
const user={id:'a',name:'User',email:'a@example.com',picture:null};
const snapshot:Snapshot={account:'a',root:'root',drives:[],files:[{id:'file',name:'Cached file',mimeType:'application/pdf',parents:['root']}],quota:{used:1,total:5},syncedAt:new Date().toISOString()};
beforeEach(()=>{vi.clearAllMocks();mocks.read.mockResolvedValue(snapshot);mocks.save.mockResolvedValue(undefined);mocks.clear.mockResolvedValue(undefined);mocks.token.mockResolvedValue('token');});
afterEach(cleanup);
it('keeps cached files visible when refresh fails and recovers on explicit retry',async()=>{
  mocks.sync.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({...snapshot,files:[{...snapshot.files[0],name:'Updated'}]});
  const {result}=renderHook(()=>useMobileDrive([user],true));
  await waitFor(()=>expect(result.current.states.a?.error).toBe('Network unavailable'));
  expect(result.current.files[0].name).toBe('Cached file');
  await act(async()=>{await result.current.sync('a');});
  expect(result.current.files[0].name).toBe('Updated');expect(result.current.states.a.error).toBe('');
});
it('does not let a late network response repopulate account data after logout',async()=>{
  let finish!:(value:Snapshot)=>void;mocks.sync.mockImplementation(()=>new Promise<Snapshot>(resolve=>{finish=resolve;}));
  const {result,rerender}=renderHook(({enabled})=>useMobileDrive([user],enabled),{initialProps:{enabled:true}});
  await waitFor(()=>expect(mocks.sync).toHaveBeenCalled());
  await act(async()=>{await result.current.clear();});rerender({enabled:false});
  await act(async()=>{finish(snapshot);});
  expect(result.current.files).toEqual([]);expect(mocks.save).not.toHaveBeenCalled();expect(mocks.clear).toHaveBeenCalledOnce();
});
it('requires explicit authorization after scope expiry, then syncs again',async()=>{
  mocks.sync.mockRejectedValueOnce(new mocks.Consent('Connect Drive')).mockResolvedValueOnce(snapshot);
  const {result}=renderHook(()=>useMobileDrive([user],true));
  await waitFor(()=>expect(result.current.states.a?.needsAccess).toBe(true));
  await act(async()=>{await result.current.sync('a');});expect(mocks.sync).toHaveBeenCalledTimes(1);
  await act(async()=>{await result.current.connect('a');});
  expect(mocks.token).toHaveBeenCalledWith('a',true);expect(result.current.states.a.needsAccess).toBe(false);
});
