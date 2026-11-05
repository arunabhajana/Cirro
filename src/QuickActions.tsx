import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, FolderPlus, FolderUp, Plus, Upload } from 'lucide-react';

export default function QuickActions({ onUpload, onNewFolder }: { onUpload: (kind: 'files' | 'folder') => void; onNewFolder: () => void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  function choose(action: () => void) { trigger.current?.focus(); setOpen(false); action(); }
  return <div className="quick-actions" ref={container}>
    <button ref={trigger} className="primary-button quick-action-trigger" aria-label="New: upload or create" aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}><Plus size={17}/><span>New</span><ChevronDown size={13}/></button>
    {open && <div className="quick-action-menu" id={id} ref={menu} role="menu" aria-label="Upload or create" onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      if (event.key === 'Tab') { setOpen(false); trigger.current?.focus(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }}>
      <span className="quick-menu-label">UPLOAD</span>
      <button role="menuitem" onClick={() => choose(() => onUpload('files'))}><span className="quick-menu-icon"><Upload size={18}/></span><span><strong>Upload files</strong><small>Select files from your computer</small></span></button>
      <button role="menuitem" onClick={() => choose(() => onUpload('folder'))}><span className="quick-menu-icon"><FolderUp size={18}/></span><span><strong>Upload folder</strong><small>Include files and subfolders</small></span></button>
      <div className="quick-menu-divider"/>
      <button role="menuitem" onClick={() => choose(onNewFolder)}><span className="quick-menu-icon"><FolderPlus size={18}/></span><span><strong>New folder</strong><small>Create a folder in your drive</small></span></button>
    </div>}
  </div>;
}
