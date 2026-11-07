import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useHomeLayout} from '../src/platforms/android/home/layout';
import {formatBytes,formatGigabytes} from '../src/platforms/android/drive/model';
import {useNotifications} from '../src/platforms/android/components/useNotifications';
beforeEach(()=>localStorage.clear());afterEach(()=>{cleanup();vi.useRealTimers();});
it('isolates layout, pins and sorting between every account and Unified across reloads',()=>{
 const view=renderHook(({scope})=>useHomeLayout(scope),{initialProps:{scope:'all'}});
 act(()=>{view.result.current.setPins(['a:one','b:two']);view.result.current.setLayout(old=>({...old,hidden:['quick']}));});
 view.rerender({scope:'a'});expect(view.result.current.pins).toEqual([]);expect(view.result.current.layout.hidden).toEqual([]);
 act(()=>{view.result.current.setPins(['a:three']);view.result.current.setPinSort('desc');view.result.current.setLayout(old=>({...old,enabled:['recent']}));});
 view.rerender({scope:'b'});expect(view.result.current.pins).toEqual([]);expect(view.result.current.layout.enabled).toContain('storage');
 view.rerender({scope:'all'});expect(view.result.current.pins).toEqual(['a:one','b:two']);expect(view.result.current.layout.hidden).toEqual(['quick']);
 view.unmount();const next=renderHook(()=>useHomeLayout('a'));expect(next.result.current.pins).toEqual(['a:three']);expect(next.result.current.pinSort).toBe('desc');expect(next.result.current.layout.enabled).toEqual(['recent']);
});
it('migrates the former shared Home into Unified only',()=>{localStorage.setItem('cirro-mobile-pins',JSON.stringify(['a:old']));const {result,rerender}=renderHook(({scope})=>useHomeLayout(scope),{initialProps:{scope:'all'}});expect(result.current.pins).toEqual(['a:old']);rerender({scope:'a'});expect(result.current.pins).toEqual([]);});
it('formats storage with at most one decimal and promotes to the nearest unit',()=>{expect(formatGigabytes(5000)).toBe('5 TB');expect(formatBytes(50000*1e6)).toBe('50 GB');expect(formatBytes(1.256e15)).toBe('1.3 PB');expect(formatBytes(999.99e9)).toBe('1 TB');expect(formatBytes(.05)).toBe('0.1 B');expect(formatBytes(NaN)).toBe('0 B');expect(formatBytes(123456789)).toBe('123.5 MB');});
it('moves a two-second banner into persistent notification history',()=>{vi.useFakeTimers();const {result}=renderHook(useNotifications);act(()=>result.current.publish('Sync needs attention','Try again',{account:'a',action:'sync',category:'sync'}));expect(result.current.banner?.title).toBe('Sync needs attention');act(()=>vi.advanceTimersByTime(2000));expect(result.current.banner).toBeNull();expect(result.current.items).toHaveLength(1);expect(result.current.items[0].read).toBe(false);act(()=>result.current.markRead());expect(result.current.items[0].read).toBe(true);});
it('respects notification categories and quiet mode',()=>{const {result}=renderHook(useNotifications);act(()=>result.current.setPreferences({...result.current.preferences,quiet:true,activity:false}));act(()=>result.current.publish('Saved','File saved'));expect(result.current.items).toEqual([]);act(()=>result.current.publish('Access','Connect Drive',{category:'errors'}));expect(result.current.items).toHaveLength(1);expect(result.current.banner).toBeNull();});
