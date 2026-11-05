
import {useDevicePreference} from './devicePreferences';
import { useEffect, useState } from 'react';

export type Appearance = 'system' | 'light' | 'dark';

function savedAppearance(): Appearance {
  try {
    const value = localStorage.getItem('dd-appearance');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}

export function useAppearance() {

  const [appearance,setAppearance]=useDevicePreference<Appearance>('device:appearance',savedAppearance(),'appearance');
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const theme = appearance === 'system' ? system.matches ? 'dark' : 'light' : appearance;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    };
    update();
    try { localStorage.setItem('dd-appearance', appearance); } catch { /* Appearance still works without local storage. */ }
    system.addEventListener('change', update);
    return () => system.removeEventListener('change', update);
  }, [appearance]);
  return { appearance, setAppearance };
}
