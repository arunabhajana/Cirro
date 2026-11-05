import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
export type ContextAction = { label: string; icon?: LucideIcon; run: () => void; disabled?: boolean; disabledReason?:string; danger?: boolean; shortcut?: string; divider?: boolean };
export type ContextState = { x: number; y: number; label: string; actions: ContextAction[] };
export default function ContextMenu({ value, onClose }: { value: ContextState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: value.x, y: value.y });
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(value.x, innerWidth - rect.width - 8)), y: Math.max(8, Math.min(value.y, innerHeight - rect.height - 8)) });
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [value]);
  useEffect(() => {
    const close = (event: Event) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', close); window.addEventListener('resize', onClose); document.addEventListener('scroll', onClose, true); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('resize', onClose); document.removeEventListener('scroll', onClose, true); document.removeEventListener('keydown', key); };
  }, [onClose]);
  return createPortal(<div ref={ref} className="adaptive-context-menu" role="menu" aria-label={value.label} style={{ left: position.x, top: position.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    if (event.key === 'Tab') { onClose(); return; }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }}><span className="context-caption">{value.label}</span>{value.actions.map((action, index) => <div key={`${action.label}-${index}`}>{action.divider && <div className="context-divider" role="separator"/>}<button role="menuitem" title={action.disabledReason} aria-label={action.disabledReason?`${action.label}. ${action.disabledReason}`:undefined} disabled={action.disabled} className={action.danger ? 'danger' : ''} onClick={() => { onClose(); action.run(); }}>{action.icon && <action.icon size={16}/>}<span>{action.label}</span>{action.shortcut && <kbd>{action.shortcut}</kbd>}</button></div>)}</div>, document.body);
}
