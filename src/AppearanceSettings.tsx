import { Check, Monitor, Moon, Sun } from 'lucide-react';
import type { Appearance } from './theme';

const choices = [{ value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }, { value: 'system', label: 'System', icon: Monitor }] as const;

export default function AppearanceSettings({ value, onChange }: { value: Appearance; onChange: (value: Appearance) => void }) {
  return <section className="panel appearance-panel">
    <div className="appearance-heading"><div><h3>Theme</h3><p>Choose a theme, or follow your device.</p></div><span className="appearance-saved"><Check size={13}/>Saved automatically</span></div>
    <div className="appearance-options" role="radiogroup" aria-label="Appearance" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = choices.findIndex(choice => choice.value === value);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + choices.length) % choices.length;
      onChange(choices[next].value);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next].focus();
    }}>
      {choices.map(({ value: mode, label, icon: Icon }) => <button key={mode} role="radio" aria-checked={value === mode} tabIndex={value === mode ? 0 : -1} className={`appearance-choice ${value === mode ? 'chosen' : ''}`} onClick={() => onChange(mode)}>
        <span className={`theme-swatch ${mode}`} aria-hidden="true"><span className="swatch-sidebar"><i/><i/><i/></span><span className="swatch-content"><i/><span><i/><i/><i/></span></span></span>
        <span className="appearance-label"><Icon size={16}/>{label}<span className="appearance-radio">{value === mode && <Check size={11}/>}</span></span>
      </button>)}
    </div>

    <p className="appearance-help">{value === 'system' ? 'Updates automatically when your device changes between light and dark.' : `${value === 'dark' ? 'Dark' : 'Light'} appearance is used throughout Cirro.`}</p>
  </section>;
}
