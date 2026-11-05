import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const native=vi.hoisted(()=>vi.fn());
const pendingWrite=vi.hoisted(()=>vi.fn(()=>Promise.resolve()));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:native}));
vi.mock('../src/drive',()=>({driveState:{error:''}}));
vi.mock('../src/devicePreferences',async()=>{const React=await import('react');return {waitForDevicePreference:pendingWrite,useDevicePreference:(_key:string,value:unknown)=>React.useState(value)};});
import NotificationSettings,{notify,notifyQuietly} from '../src/NotificationSettings';
afterEach(()=>{cleanup();native.mockReset();pendingWrite.mockReset();pendingWrite.mockResolvedValue();});
it('shows working switches for all notification preferences',()=>{render(<NotificationSettings/>);for(const title of ['Desktop notifications','Upload complete','Transfer errors','Storage warnings','Do not disturb','Notification sound'])expect(screen.getByRole('switch',{name:title})).toBeTruthy();const dnd=screen.getByRole('switch',{name:'Do not disturb'});fireEvent.click(dnd);expect(dnd.getAttribute('aria-checked')).toBe('true');});
it('explains development suppression instead of claiming a Windows notification was sent',async()=>{native.mockResolvedValue('development');render(<NotificationSettings/>);fireEvent.click(screen.getByRole('button',{name:'Send test'}));await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('native desktop notifications are disabled'));});
it('surfaces native permission failures in the test control',async()=>{native.mockRejectedValue('Windows has disabled Cirro notifications.');render(<NotificationSettings/>);fireEvent.click(screen.getByRole('button',{name:'Send test'}));await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('Windows has disabled'));});
it('waits for preference writes before asking Windows to send',async()=>{
 let finish!:()=>void;pendingWrite.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));native.mockResolvedValue('muted');
 const sent=notify('test','Check','Preferences');expect(native).not.toHaveBeenCalled();finish();expect(await sent).toBe('muted');expect(pendingWrite).toHaveBeenCalledWith('notifications');
});
it('muted and failed delivery do not suppress a later valid notification',async()=>{
 native.mockResolvedValueOnce('muted').mockRejectedValueOnce('Windows unavailable').mockResolvedValue('sent');
 for(let attempt=0;attempt<3;attempt++){notifyQuietly('errors','Retry delivery','Test delivery retry');await act(async()=>{});}
 expect(native).toHaveBeenCalledTimes(3);notifyQuietly('errors','Retry delivery','Test delivery retry');await act(async()=>{});expect(native).toHaveBeenCalledTimes(3);
});
it('coalesces repeated events while a notification is being delivered',async()=>{
 let finish!:(value:string)=>void;native.mockImplementationOnce(()=>new Promise<string>(resolve=>{finish=resolve;}));
 notifyQuietly('uploads','Upload complete','Unique pending upload');notifyQuietly('uploads','Upload complete','Unique pending upload');await act(async()=>{});
 expect(native).toHaveBeenCalledTimes(1);await act(async()=>finish('sent'));
});
it('reports muted notifications and prevents repeated test clicks during delivery',async()=>{
 let finish!:(value:string)=>void;native.mockImplementationOnce(()=>new Promise<string>(resolve=>{finish=resolve;}));render(<NotificationSettings/>);
 fireEvent.click(screen.getByRole('button',{name:'Send test'}));await act(async()=>{});expect((screen.getByRole('button',{name:'Sending…'}) as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>finish('muted'));expect(screen.getByRole('status').textContent).toContain('muted by your Cirro preferences');
});
