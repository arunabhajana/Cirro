import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,waitFor} from '@testing-library/react';
const api=vi.hoisted(()=>({invoke:vi.fn(),notify:vi.fn(),changed:()=>{}}));
vi.mock('../src/ipc',()=>({invoke:api.invoke}));
vi.mock('../src/NotificationSettings',()=>({notifyQuietly:api.notify}));
vi.mock('@tauri-apps/api/event',()=>({listen:(_event:string,callback:()=>void)=>{api.changed=callback;return Promise.resolve(()=>{});}}));
import {TransferEvents} from '../src/TransferCentre';
const job={id:'one',kind:'upload',account:'account',target:'account',name:'Report.pdf',state:'running',error:'',bytes:0,total:100,data:{}};
afterEach(()=>{cleanup();api.invoke.mockReset();api.notify.mockReset();});
it('notifies on new transfer failures and completed uploads without replaying history',async()=>{
 let jobs=[{...job,id:'old',state:'completed'},job];api.invoke.mockImplementation(()=>Promise.resolve(jobs));render(<TransferEvents/>);
 await waitFor(()=>expect(api.invoke).toHaveBeenCalledOnce());await act(async()=>{});expect(api.notify).not.toHaveBeenCalled();
 jobs=[jobs[0],{...job,state:'waiting',error:'Connection unavailable'}];await act(async()=>api.changed());
 expect(api.notify).toHaveBeenCalledWith('errors','Transfer waiting to retry','Report.pdf: Connection unavailable');
 api.notify.mockClear();await act(async()=>api.changed());expect(api.notify).not.toHaveBeenCalled();
 jobs=[jobs[0],{...job,state:'completed'}];await act(async()=>api.changed());expect(api.notify).toHaveBeenCalledWith('uploads','Upload complete','Report.pdf');
 api.notify.mockClear();await act(async()=>api.changed());expect(api.notify).not.toHaveBeenCalled();
});
it('serializes event refreshes and ignores results after the workspace unmounts',async()=>{
 let finish!:(value:typeof job[])=>void;api.invoke.mockImplementationOnce(()=>new Promise<typeof job[]>(resolve=>{finish=resolve;})).mockResolvedValue([{...job,state:'attention',error:'Access denied'}]);
 const mounted=render(<TransferEvents/>);api.changed();api.changed();expect(api.invoke).toHaveBeenCalledOnce();
 await act(async()=>finish([job]));expect(api.invoke).toHaveBeenCalledTimes(2);expect(api.notify).toHaveBeenCalledWith('errors','Transfer needs attention','Report.pdf: Access denied');
 mounted.unmount();api.notify.mockClear();await act(async()=>api.changed());expect(api.invoke).toHaveBeenCalledTimes(2);expect(api.notify).not.toHaveBeenCalled();
});
