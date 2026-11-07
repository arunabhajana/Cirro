import { beforeEach, expect, it, vi } from 'vitest';
const native=vi.hoisted(()=>({surface:vi.fn(),style:vi.fn(),show:vi.fn()}));
vi.mock('@capacitor/core',()=>({
  Capacitor:{isNativePlatform:()=>true},
  registerPlugin:()=>({setTheme:native.surface}),
  SystemBars:{setStyle:native.style,show:native.show},
  SystemBarsStyle:{Dark:'DARK',Light:'LIGHT'},
}));
import { applyMobileTheme } from '../src/platforms/android/theme';
beforeEach(()=>{vi.clearAllMocks();native.surface.mockResolvedValue(undefined);native.style.mockResolvedValue(undefined);native.show.mockResolvedValue(undefined);});
it('matches the native window surface before applying contrasting icons',async()=>{
  applyMobileTheme(false);
  await vi.waitFor(()=>expect(native.show).toHaveBeenCalled());
  expect(native.surface).toHaveBeenCalledWith({dark:false});
  expect(native.style).toHaveBeenCalledWith({style:'LIGHT'});
  expect(native.surface.mock.invocationCallOrder[0]).toBeLessThan(native.style.mock.invocationCallOrder[0]);
  applyMobileTheme(true);
  await vi.waitFor(()=>expect(native.style).toHaveBeenLastCalledWith({style:'DARK'}));
  expect(native.surface).toHaveBeenLastCalledWith({dark:true});
  expect(document.documentElement.dataset.theme).toBe('dark');
});
it('does not apply a stale icon style after a rapid theme change',async()=>{
  let finish!:()=>void;
  native.surface.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  applyMobileTheme(true);applyMobileTheme(false);
  await vi.waitFor(()=>expect(native.style).toHaveBeenCalledWith({style:'LIGHT'}));
  finish();await new Promise(resolve=>setTimeout(resolve,0));
  expect(native.style).not.toHaveBeenCalledWith({style:'DARK'});
});
