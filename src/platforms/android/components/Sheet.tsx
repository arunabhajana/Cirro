import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="m-sheet" aria-label={title} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="m-sheet-handle"/><header><h2>{title}</h2><button className="m-icon-button" aria-label="Close" onClick={onClose}><X size={20}/></button></header>
    {children}
  </dialog>;
}
