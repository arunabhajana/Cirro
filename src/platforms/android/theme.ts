import { useEffect, useState } from 'react';
import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core';

const AppAppearance=registerPlugin<{setTheme(options:{dark:boolean}):Promise<void>}>('AppAppearance');
let revision=0;
export const accentColours={blue:{name:'Blue',light:'#007aff',dark:'#409cff'},purple:{name:'Purple',light:'#8455d9',dark:'#bf9aff'},green:{name:'Green',light:'#187c56',dark:'#46d49b'},rose:{name:'Rose',light:'#c53f71',dark:'#ff84b1'},orange:{name:'Orange',light:'#b45c05',dark:'#ffb054'}};
export type Accent=keyof typeof accentColours;
function savedAccent():Accent{try{const value=localStorage.getItem('cirro-mobile-accent')||'blue';return value in accentColours?value as Accent:'blue';}catch{return 'blue';}}
function applyAccent(accent:Accent,dark:boolean){const colour=accentColours[accent][dark?'dark':'light'];document.documentElement.style.setProperty('--m-accent',colour);document.documentElement.style.setProperty('--m-blue-surface',colour+(dark?'20':'0d'));}

function savedDark() { try { return localStorage.getItem('cirro-mobile-theme') === 'dark'; } catch { return false; } }
export function applyMobileTheme(dark: boolean) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101012' : '#ffffff');
  if (Capacitor.isNativePlatform()) {
    const current=++revision;
    // Match the Android theme surface BEFORE SystemBars reads windowBackground.
    void AppAppearance.setTheme({dark}).catch(()=>{}).then(async()=>{
      if(current!==revision)return;
      await SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
      if(current===revision)await SystemBars.show();
    }).catch(()=>{});
  }
}
export function initializeMobileTheme() { applyMobileTheme(savedDark());applyAccent(savedAccent(),savedDark()); }
export function useMobileTheme() {
  const [dark, setDark] = useState(savedDark);
  const [accent,setAccent]=useState<Accent>(savedAccent);
  useEffect(() => { applyMobileTheme(dark); try { localStorage.setItem('cirro-mobile-theme', dark ? 'dark' : 'light'); } catch {} }, [dark]);
  useEffect(()=>{applyAccent(accent,dark);try{localStorage.setItem('cirro-mobile-accent',accent);}catch{}},[accent,dark]);
  return { dark, setDark,accent,setAccent };
}
