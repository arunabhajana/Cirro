import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import MobileApp from '../src/platforms/android/MobileApp';
import { accessRequestUrl } from '../src/platforms/android/components/AccessRequest';

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.scrollTo = vi.fn();
});
afterEach(cleanup);

it('shows sign-in and the access form, with a separate preview entry', async () => {
  render(<MobileApp/>);
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
  const earlyAccess=await screen.findByRole('dialog', { name: 'Cirro early access' });
  fireEvent.click(within(earlyAccess).getByRole('button', { name: /Need access/ }));
  expect(within(earlyAccess).getByLabelText('Google account email')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Explore UI preview' }));
  expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy();
  expect(screen.getByText('5.8 GB left')).toBeTruthy();
  expect(screen.getByText('11.4 GB left')).toBeTruthy();
});

it('prepares an encoded request to the existing access-review address', () => {
  const url = new URL(accessRequestUrl(' name+test@gmail.com '));
  expect(url.pathname).toBe('arunabhajana@gmail.com');
  expect(url.searchParams.get('body')).toContain('name+test@gmail.com');
});

it('starts with storage and composition, and saves widget choices', () => {
  const view = render(<MobileApp initialScreen="workspace"/>);
  expect(screen.getByRole('region', { name: 'Home widgets' }).textContent).toContain('File composition');
  fireEvent.click(screen.getByLabelText('Customize home'));
  fireEvent.click(screen.getByRole('switch', { name: 'Storage' }));
  fireEvent.click(screen.getByLabelText('Close'));
  view.unmount();
  render(<MobileApp initialScreen="workspace"/>);
  expect(screen.getByRole('region', { name: 'Home widgets' }).textContent).not.toContain('Storage');
});

it('starts without pins and lets users pin, reopen and unpin folders', () => {
  const view = render(<MobileApp initialScreen="workspace"/>);
  expect(screen.getByText('Pin folders to Home')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Edit pinned folders'));
  fireEvent.click(screen.getByRole('button', { name: /Projects.*Personal/ }));
  fireEvent.click(screen.getByLabelText('Close'));
  view.unmount();
  render(<MobileApp initialScreen="workspace"/>);
  expect(screen.getByLabelText('Unpin Projects')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Unpin Projects'));
  expect(screen.getByText('Pin folders to Home')).toBeTruthy();
});

it('toggles dark mode in Settings and restores it on the next launch', () => {
  const view=render(<MobileApp initialScreen="workspace"/>);
  fireEvent.click(screen.getByLabelText('More pages'));
  fireEvent.click(screen.getByRole('button',{name:'Settings'}));
  fireEvent.click(screen.getByRole('button',{name:/Appearance/}));
  fireEvent.click(screen.getByRole('switch',{name:/Dark mode/}));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('cirro-mobile-theme')).toBe('dark');
  view.unmount();render(<MobileApp initialScreen="workspace"/>);
  expect(document.documentElement.dataset.theme).toBe('dark');
});


it('provides eight widgets, persists section hiding and supports widget and section ordering',()=>{
  const view=render(<MobileApp initialScreen="workspace"/>);
  fireEvent.click(screen.getByLabelText('Hide Widgets'));
  expect(screen.queryByRole('region',{name:'Home widgets'})).toBeNull();
  fireEvent.click(screen.getByLabelText('Customize home'));
  fireEvent.click(screen.getByRole('switch',{name:'Show Widgets section'}));
  expect(screen.getAllByRole('switch')).toHaveLength(11);
  fireEvent.click(screen.getByRole('switch',{name:'Offline files'}));
  fireEvent.click(screen.getByLabelText('Move Widgets section down'));
  fireEvent.click(screen.getByLabelText('Move Recent files widget up'));
  fireEvent.click(screen.getByLabelText('Close'));
  expect(screen.getByRole('region',{name:'Home widgets'}).textContent).toContain('Offline files');
  view.unmount();render(<MobileApp initialScreen="workspace"/>);
  const layout=JSON.parse(localStorage.getItem('cirro-homes-v4')!).all.layout;
  expect(layout.sections[0]).toBe('quick');expect(layout.widgets[1]).toBe('recent');expect(layout.enabled).toContain('offline');
});
it('shows the unified avatar and persists accent choices',()=>{
  render(<MobileApp initialScreen="workspace"/>);expect(screen.getByLabelText('Unified mode')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('More pages'));fireEvent.click(screen.getByRole('button',{name:'Settings'}));fireEvent.click(screen.getByRole('button',{name:/Appearance/}));fireEvent.click(screen.getByRole('radio',{name:'Purple'}));expect(localStorage.getItem('cirro-mobile-accent')).toBe('purple');expect(document.documentElement.style.getPropertyValue('--m-accent')).toBeTruthy();
});

it('keeps Unified and account Home choices separate in the switcher',()=>{
 render(<MobileApp initialScreen="workspace"/>);fireEvent.click(screen.getByLabelText('Hide Quick actions'));
 fireEvent.click(screen.getByLabelText('Edit pinned folders'));fireEvent.click(screen.getByRole('button',{name:/Projects.*Personal/}));fireEvent.click(screen.getByLabelText('Close'));
 fireEvent.click(screen.getByLabelText('Switch account'));fireEvent.click(screen.getByRole('button',{name:/Personal.*alex@gmail/}));
 expect(screen.getByText('Pin folders to Home')).toBeTruthy();expect(screen.getByLabelText('Hide Quick actions')).toBeTruthy();
 fireEvent.click(screen.getByLabelText('Switch account'));fireEvent.click(screen.getByRole('button',{name:/Unified.*All/}));
 expect(screen.getByLabelText('Unpin Projects')).toBeTruthy();expect(screen.queryByLabelText('Hide Quick actions')).toBeNull();
});
it('toggles file and pinned-folder ordering in both directions',()=>{
 render(<MobileApp initialScreen="workspace"/>);fireEvent.click(screen.getByLabelText('Edit pinned folders'));fireEvent.click(screen.getByRole('button',{name:/Projects.*Personal/}));fireEvent.click(screen.getByRole('button',{name:/Documents.*Personal/}));fireEvent.click(screen.getByLabelText('Close'));
 fireEvent.click(screen.getByLabelText('Sort pinned folders Z–A'));expect(screen.getAllByLabelText(/Unpin /).map(el=>el.getAttribute('aria-label'))).toEqual(['Unpin Projects','Unpin Documents']);
 fireEvent.click(screen.getByLabelText('Sort pinned folders A–Z'));expect(screen.getAllByLabelText(/Unpin /).map(el=>el.getAttribute('aria-label'))).toEqual(['Unpin Documents','Unpin Projects']);
 fireEvent.click(screen.getByLabelText('All files'));const initial=screen.getAllByLabelText(/Actions for /).map(el=>el.getAttribute('aria-label'));
 fireEvent.click(screen.getByLabelText('Sort files Z–A'));expect(screen.getAllByLabelText(/Actions for /).map(el=>el.getAttribute('aria-label'))).toEqual([...initial].reverse());
 fireEvent.click(screen.getByLabelText('Sort files A–Z'));expect(screen.getAllByLabelText(/Actions for /).map(el=>el.getAttribute('aria-label'))).toEqual(initial);
});
it('saves an account label and colour from grouped settings',()=>{
 render(<MobileApp initialScreen="workspace"/>);fireEvent.click(screen.getByLabelText('More pages'));fireEvent.click(screen.getByRole('button',{name:'Settings'}));fireEvent.click(screen.getByRole('button',{name:/Account settings/}));fireEvent.click(screen.getByRole('button',{name:/Personal.*alex@gmail/}));fireEvent.change(screen.getByLabelText('Account label'),{target:{value:'Family'}});fireEvent.click(screen.getByRole('radio',{name:'Green'}));fireEvent.click(screen.getByLabelText('Close'));fireEvent.click(screen.getByLabelText('Switch account'));expect(screen.getByRole('button',{name:/Family.*alex@gmail/})).toBeTruthy();expect(JSON.parse(localStorage.getItem('cirro-account-preferences-v1')!).personal).toEqual({label:'Family',color:'#2c9267'});
});
