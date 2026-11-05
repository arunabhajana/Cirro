import {act,cleanup,render,renderHook,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/api/core',()=>({invoke:native,isTauri:()=>true}));
import {useDevicePreference} from '../src/devicePreferences';
import StorageUsageBar from '../src/StorageUsageBar';
afterEach(cleanup);
beforeEach(()=>{native.mockReset();});
it('keeps Unified and account Home layouts separate and restores Unified on return',async()=>{
 const store=new Map<string,unknown>([['home:test-unified:pins',['one::folder']],['home:test-account:pins',['two::folder']]]);
 native.mockImplementation((command,args)=>{if(command==='device_setting'){store.set(args.key,args.value);return Promise.resolve();}return Promise.resolve(store.get(args.key)??null);});
 const {result,rerender}=renderHook(({scope})=>useDevicePreference<string[]>(`home:${scope}:pins`,[]),{initialProps:{scope:'test-unified'}});
 await waitFor(()=>expect(result.current[0]).toEqual(['one::folder']));
 act(()=>result.current[1](old=>[...old,'two::extra']));
 await waitFor(()=>expect(store.get('home:test-unified:pins')).toEqual(['one::folder','two::extra']));
 rerender({scope:'test-account'});await waitFor(()=>expect(result.current[0]).toEqual(['two::folder']));
 rerender({scope:'test-unified'});await waitFor(()=>expect(result.current[0]).toEqual(['one::folder','two::extra']));
});
it('does not overwrite a new edit with a late initial preference read',async()=>{
 let resolve!:(value:unknown)=>void;native.mockImplementation(command=>command==='device_preference'?new Promise(r=>{resolve=r;}):Promise.resolve());
 const {result}=renderHook(()=>useDevicePreference('home:test-late:widgets',{storage:true}));
 act(()=>result.current[1]({storage:false}));await act(async()=>resolve({storage:true}));expect(result.current[0]).toEqual({storage:false});
});
it('uses account colours and total capacity for each bar segment',()=>{
 render(<StorageUsageBar accounts={[{id:'one',name:'Personal',used:10,total:50,color:'#579dff'},{id:'two',name:'Work',used:20,total:50,color:'#b58aff'}]}/>);
 const bar=screen.getByRole('meter');expect(bar.getAttribute('aria-valuenow')).toBe('30');const segments=bar.querySelectorAll<HTMLElement>('span');expect(segments[0].style.width).toBe('10%');expect(segments[1].style.width).toBe('20%');expect(segments[0].style.background).not.toBe(segments[1].style.background);
});
