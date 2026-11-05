import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {act} from 'react';
import SettingsChoice from '../src/SettingsChoice';
import SettingsDisclosure from '../src/SettingsDisclosure';
afterEach(cleanup);
const options=[{value:'keep',label:'Keep both',description:'Save a separate copy.'},{value:'replace',label:'Replace existing'},{value:'ask',label:'Ask each time'}];
it('custom choices support keyboard selection and preserve the value on Escape',()=>{
 const change=vi.fn();render(<SettingsChoice label="Conflicts" value="keep" options={options} onChange={change}/>);
 const trigger=screen.getByRole('combobox');trigger.focus();fireEvent.keyDown(trigger,{key:'ArrowDown'});
 expect(screen.getByRole('listbox')).toBeTruthy();fireEvent.keyDown(trigger,{key:'ArrowDown'});fireEvent.keyDown(trigger,{key:'Enter'});
 expect(change).toHaveBeenCalledWith('replace');expect(screen.queryByRole('listbox')).toBeNull();expect(document.activeElement).toBe(trigger);
 change.mockClear();fireEvent.click(trigger);fireEvent.keyDown(trigger,{key:'End'});fireEvent.keyDown(trigger,{key:'Escape'});
 expect(change).not.toHaveBeenCalled();expect(screen.queryByRole('listbox')).toBeNull();
});
it('custom choices close outside and use the selected value when reopened',()=>{
 const change=vi.fn();render(<SettingsChoice label="Conflicts" value="ask" options={options} onChange={change}/>);
 const trigger=screen.getByRole('combobox');fireEvent.click(trigger);expect(screen.getByRole('option',{name:'Ask each time'}).getAttribute('aria-selected')).toBe('true');
 fireEvent.pointerDown(document.body);expect(screen.queryByRole('listbox')).toBeNull();expect(change).not.toHaveBeenCalled();
 fireEvent.click(trigger);fireEvent.click(screen.getByRole('option',{name:/Keep both/}));expect(change).toHaveBeenCalledWith('keep');
});
it('disabled choices cannot be opened',()=>{
 render(<SettingsChoice label="Conflicts" value="keep" options={options} onChange={vi.fn()} disabled/>);
 fireEvent.click(screen.getByRole('combobox'));expect(screen.queryByRole('listbox')).toBeNull();
});
it('disclosures use explicit state and reveal nested settings for search',()=>{
 render(<SettingsDisclosure title="Advanced"><h3>Cloud downloads</h3><button>Configure</button></SettingsDisclosure>);
 const trigger=screen.getByRole('button',{name:'Advanced'});expect(trigger.getAttribute('aria-expanded')).toBe('false');expect(screen.queryByRole('button',{name:'Configure'})).toBeNull();
 act(()=>screen.getByText('Cloud downloads').dispatchEvent(new Event('cirro-reveal-setting',{bubbles:true})));
 expect(trigger.getAttribute('aria-expanded')).toBe('true');expect(screen.getByRole('button',{name:'Configure'})).toBeTruthy();
 fireEvent.click(trigger);expect(screen.queryByRole('button',{name:'Configure'})).toBeNull();
});
