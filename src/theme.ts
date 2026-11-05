
import {useDevicePreference} from './devicePreferences';
import { useEffect } from 'react';
import {applyVisualPreferences,defaultVisualPreferences,normalizeVisualPreferences,type VisualPreferences} from './visualPreferences';

export type Appearance = 'system' | 'light' | 'dark';

function savedVisual():VisualPreferences{try{return normalizeVisualPreferences(JSON.parse(localStorage.getItem('cirro-visual-preferences')||'null'));}catch{return defaultVisualPreferences;}}
function savedAppearance(): Appearance {
  try {
    const value = localStorage.getItem('dd-appearance');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}

export function useAppearance() {

  const [storedVisual,setVisual]=useDevicePreference<VisualPreferences>('device:visualPreferences',savedVisual());
  const visual=normalizeVisualPreferences(storedVisual);
  const [appearance,setAppearance]=useDevicePreference<Appearance>('device:appearance',savedAppearance(),'appearance');
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const theme = appearance === 'system' ? system.matches ? 'dark' : 'light' : appearance;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      applyVisualPreferences(visual,theme==='dark');
    };
    update();
    try { localStorage.setItem('dd-appearance', appearance); localStorage.setItem('cirro-visual-preferences',JSON.stringify(visual)); } catch { /* Appearance still works without local storage. */ }
    system.addEventListener('change', update);
    return () => system.removeEventListener('change', update);
  }, [appearance,visual.accent,visual.motion,visual.reduceTransparency]);
  return { appearance, setAppearance,visual,setVisual };
}
