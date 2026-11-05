import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const call=vi.hoisted(()=>vi.fn());
vi.mock('../src/ipc',()=>({invoke:call}));
vi.mock('@tauri-apps/api/event',()=>({listen:()=>Promise.resolve(()=>{})}));
import CloudSettings from '../src/CloudSettings';
afterEach(()=>{cleanup();call.mockReset();});
const source={id:'work-flow',account:'two',name:'Projects'};
it('creates an explicitly read-only view for its owning Flow and opens only the registered path',async()=>{
 call.mockImplementation((_command,args)=>Promise.resolve(args.action==='list'?[]:args.action==='create'?'C:\\Users\\Example\\Cirro Cloud\\work\\Projects':null));
 render(<CloudSettings sources={[source]}/>);
 expect(screen.getByText('Read-only cloud views')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Create cloud view'}));
 expect(screen.getByRole('dialog',{name:'Try Cirro Cloud preview?'})).toBeTruthy();
 expect(call.mock.calls.some(([,args])=>args.action==='create')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Enable preview'}));
 await waitFor(()=>expect(call).toHaveBeenCalledWith('cloud_files_command',{action:'open',id:'C:\\Users\\Example\\Cirro Cloud\\work\\Projects'}));
 expect(call).toHaveBeenCalledWith('cloud_files_command',{action:'create',id:'work-flow'});
});
it('shows setup failures and enables a deliberate retry without opening a partial view',async()=>{
 call.mockImplementation((_command,args)=>args.action==='create'?Promise.reject('Google Drive is unreachable. Please retry.'):Promise.resolve([]));
 render(<CloudSettings sources={[source]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Create cloud view'}));
 fireEvent.click(screen.getByRole('button',{name:'Enable preview'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('unreachable'));
 expect(call.mock.calls.some(([,args])=>args.action==='open')).toBe(false);
 await waitFor(()=>expect(screen.getByRole<HTMLButtonElement>('button',{name:'Create cloud view'}).disabled).toBe(false));
});
it('cancelling the preview warning never creates a cloud view',async()=>{
 call.mockResolvedValue([]);render(<CloudSettings sources={[source]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Create cloud view'}));
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
 expect(screen.queryByRole('dialog')).toBeNull();expect(call.mock.calls.some(([,args])=>args.action==='create')).toBe(false);
});
it('removes orphaned cloud views only after explaining what remains locally',async()=>{
 const root={path:'C:\\Users\\Example\\Cirro Cloud\\work\\Projects',account:'two',pair:'stopped-flow',name:'Projects',status:'Ready'};
 let removed=false;
 call.mockImplementation((_command,args)=>{if(args.action==='remove'){removed=true;return Promise.resolve(null);}return Promise.resolve(removed?[]:[root]);});
 render(<CloudSettings sources={[]}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Remove'}));
 expect(screen.getByRole('dialog',{name:'Remove Cirro Cloud view?'}).textContent).toContain('Fully downloaded files stay');
 expect(call.mock.calls.some(([,args])=>args.action==='remove')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Remove cloud view'}));
 await waitFor(()=>expect(call).toHaveBeenCalledWith('cloud_files_command',{action:'remove',id:root.path}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Remove'})).toBeNull());
});
it('failed removal retains the view and lets the user retry',async()=>{
 const root={path:'C:\\Users\\Example\\Cirro Cloud\\work\\Projects',account:'two',pair:source.id,name:'Projects',status:'Ready'};
 call.mockImplementation((_command,args)=>args.action==='remove'?Promise.reject('Close files in this view and try again.'):Promise.resolve([root]));
 render(<CloudSettings sources={[source]}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Remove'}));fireEvent.click(screen.getByRole('button',{name:'Remove cloud view'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Close files'));
 await waitFor(()=>expect(screen.getByRole<HTMLButtonElement>('button',{name:'Remove'}).disabled).toBe(false));
});
