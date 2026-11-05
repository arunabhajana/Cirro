import { useEffect, useState, type ReactNode } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { BrandLogo } from './branding';
import { Copy, Minus, Square, X } from 'lucide-react';

export default function Titlebar({ search }: { search?: ReactNode }) {
  const native = isTauri();
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const window = getCurrentWindow();
    const update = () => window.isMaximized().then(value => { if (!disposed) setMaximized(value); });
    update().catch(() => {});
    window.onResized(() => { update().catch(() => {}); }).then(stop => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, [native]);

  async function control(action: 'minimize' | 'maximize' | 'close') {
    if (!native) return;
    try {
      const window = getCurrentWindow();
      if (action === 'minimize') await invoke('startup_minimize');
      else if (action === 'close') await window.close();
      else { await window.toggleMaximize(); setMaximized(await window.isMaximized()); }
      setError('');
    } catch { setError('Unable to change the window. Please try again.'); }
  }

  return <header className="titlebar" data-tauri-drag-region>
    <div className="titlebar-brand" data-tauri-drag-region>
      <BrandLogo className="app-logo"/>
      <span>Cirro</span>
    </div>
    <div className="titlebar-center" data-tauri-drag-region>{search}</div>
    <div className="window-controls" aria-label="Window controls">
      <button aria-label="Minimize window" title={native ? 'Minimize' : 'Minimize — available in the desktop app'} disabled={!native} onClick={() => control('minimize')}><Minus size={16}/></button>
      <button aria-label={maximized ? 'Restore window' : 'Maximize window'} title={native ? maximized ? 'Restore' : 'Maximize' : 'Maximize — available in the desktop app'} disabled={!native} onClick={() => control('maximize')}>{maximized ? <Copy size={13}/> : <Square size={13}/>}</button>
      <button className="window-close" aria-label="Close window" title={native ? 'Close' : 'Close — available in the desktop app'} disabled={!native} onClick={() => control('close')}><X size={17}/></button>
    </div>
    {error && <div className="window-error" role="alert">{error}<button aria-label="Dismiss window error" onClick={() => setError('')}><X size={14}/></button></div>}
  </header>;
}
