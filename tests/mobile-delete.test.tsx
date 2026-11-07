import {expect,it,vi} from 'vitest';
import {DriveClient} from '../src/platforms/android/drive/client';
it('accepts empty 204 responses for file and permission deletion',async()=>{const fetcher=vi.fn(async()=>new Response(null,{status:204}));const client=new DriveClient(async()=> 'test-token',fetcher as typeof fetch);await client.deleteFile('a','file');await client.request('a','files/file/permissions/permission',{supportsAllDrives:'true'},undefined,'DELETE');expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[0][1]?.method).toBe('DELETE');});
