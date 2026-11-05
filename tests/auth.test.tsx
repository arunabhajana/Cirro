import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import App from '../src/App';
import { AuthProvider } from '../src/auth';

const native = vi.hoisted(() => ({ desktop: true, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => native.desktop, invoke: native.invoke }));
vi.mock('../src/Titlebar', () => ({ default: () => <header>Cirro</header> }));
const user = { id: 'google-subject-123', name: 'Maya Sharma', email: 'maya@example.test', picture: null };
const launch = () => render(<StrictMode><AuthProvider><App/></AuthProvider></StrictMode>);

beforeEach(() => {
  localStorage.clear(); native.desktop = true;
  window.history.replaceState(null, '', '/');
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  native.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === 'auth_status') return { configured: true, user: null };
    if (command === 'auth_sign_in') return user;
  });
});
afterEach(cleanup);

describe('single Google account integration', () => {
  it('requires authentication, even with an old login hash or saved mock files', async () => {
    window.history.replaceState(null, '', '/#login');
    launch();
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    expect(screen.queryByText('Explore the design')).toBeNull();
  });

  it('signs in to Home, shows one real profile in the sidebar and Settings, and signs out', async () => {
    launch();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    await screen.findByRole('heading', { name: 'Home', exact: true });
    expect(native.invoke).toHaveBeenCalledWith('auth_sign_in');
    fireEvent.click(screen.getByRole('button', { name: 'Google account: Maya Sharma' }));
    const picker = screen.getByRole('region', { name: 'Google account' });
    expect(within(picker).getByText(user.email)).toBeTruthy();
    expect(within(picker).queryByText('Add Google account')).toBeNull();
    expect(within(picker).queryByText('All accounts')).toBeNull();
    expect(within(picker).queryByText('arun@studio.design')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Accounts', exact: true }));
    const settings = document.querySelector('.settings-results') as HTMLElement;
    expect(within(settings).getByText(user.email)).toBeTruthy();
    fireEvent.click(within(settings).getByRole('button', { name: 'Sign out', exact: true }));
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(native.invoke).toHaveBeenCalledWith('auth_sign_out');
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    expect(Object.values(localStorage).join('')).not.toContain(user.email);
  });

  it('restores a saved account to Home and supports sidebar sign-out', async () => {
    native.invoke.mockImplementation(async (command: string) => command === 'auth_status' ? { configured: true, user } : undefined);
    launch();
    await screen.findByRole('heading', { name: 'Home', exact: true });
    expect(native.invoke).not.toHaveBeenCalledWith('auth_sign_in');
    fireEvent.click(screen.getByRole('button', { name: 'Google account: Maya Sharma' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Google account' })).getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('button', { name: 'Continue with Google' });
  });

  it('surfaces configuration errors and never bypasses login', async () => {
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'auth_status') return { configured: false, user: null };
      throw 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart the desktop app.';
    });
    launch();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect((await screen.findByRole('alert')).textContent).toContain('GOOGLE_CLIENT_ID');
    expect(screen.queryByRole('heading', { name: 'Home', exact: true })).toBeNull();
  });

  it('cancels a pending browser sign-in and allows a fresh attempt', async () => {
    let rejectAttempt: (reason: string) => void = () => {};
    native.invoke.mockImplementation((command: string) => {
      if (command === 'auth_status') return Promise.resolve({ configured: true, user: null });
      if (command === 'auth_sign_in') return new Promise((_, reject) => { rejectAttempt = reject; });
      if (command === 'auth_cancel') { rejectAttempt('Sign-in cancelled.'); return Promise.resolve(); }
    });
    launch();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    const waiting = await screen.findByRole('button', { name: 'Waiting for Google…' });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Continue with Google' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Home', exact: true })).toBeNull();
  });

  it('keeps the account visible when secure session removal fails', async () => {
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'auth_status') return { configured: true, user };
      if (command === 'auth_sign_out') throw 'Could not remove the saved session. Please try signing out again.';
    });
    launch();
    fireEvent.click(await screen.findByRole('button', { name: 'Google account: Maya Sharma' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Google account' })).getByRole('button', { name: 'Sign out' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not remove');
    expect(screen.getByRole('button', { name: 'Google account: Maya Sharma' })).toBeTruthy();
  });

  it('explains the desktop requirement in browser previews without calling native auth', async () => {
    native.desktop = false; launch();
    const signIn = await screen.findByRole('button', { name: 'Continue with Google' });
    expect((signIn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('npm run tauri dev')).toBeTruthy();
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it('pins a file to Home from its context menu without an add-items catalog', async () => {
    native.invoke.mockImplementation(async () => ({ configured:true, user }));
    launch(); await screen.findByRole('heading',{name:'Home',exact:true});
    fireEvent.click(screen.getByRole('button',{name:'Recent',exact:true}));
    const file = screen.getByRole('button',{name:'Website proposal.pdf',exact:true});
    fireEvent.contextMenu(file.closest('tr')!,{clientX:500,clientY:300});
    fireEvent.click(await screen.findByRole('menuitem',{name:'Pin to Home',exact:true}));
    fireEvent.click(screen.getByRole('button',{name:'Home',exact:true}));
    expect(screen.getByRole('button',{name:/Website proposal.pdf.*PDF document/})).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('dd-pins') || '[]')).toContain('f1');
    expect(screen.queryByRole('button',{name:'Pin folder'})).toBeNull();
  });
  it('changes the logo across the UI and persists the selected style', async () => {
    native.invoke.mockImplementation(async () => ({ configured:true, user }));
    launch(); await screen.findByRole('heading',{name:'Home',exact:true});
    fireEvent.click(screen.getByRole('button',{name:'Settings',exact:true}));
    fireEvent.click(screen.getByRole('button',{name:'Appearance',exact:true}));
    const choices = screen.getByRole('radiogroup',{name:'App icon style'});
    const glass = within(choices).getByRole('radio',{name:/Frosted glass/}); fireEvent.click(glass);
    expect(glass.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('cirro-logo-style')).toBe('glass');
    expect(document.querySelector('.sidebar-brand')).toBeNull();
    fireEvent.keyDown(glass,{key:'Home'}); expect(localStorage.getItem('cirro-logo-style')).toBe('transparent');
  });
  it('creates a folder with the chosen appearance and destination', async () => {
    native.invoke.mockImplementation(async () => ({configured:true,user}));
    launch(); await screen.findByRole('heading',{name:'Home',exact:true});
    fireEvent.click(screen.getByRole('button',{name:'New: upload or create'}));
    fireEvent.click(screen.getByRole('menuitem',{name:/New folder/}));
    const dialog=screen.getByRole('dialog',{name:'New folder'});
    fireEvent.change(within(dialog).getByRole('textbox',{name:'Folder name'}),{target:{value:'Travel plans'}});
    fireEvent.change(within(dialog).getByRole('combobox',{name:'Destination drive'}),{target:{value:'work'}});
    fireEvent.click(within(dialog).getByRole('button',{name:'Purple folder color'}));
    fireEvent.click(within(dialog).getByRole('button',{name:'Photos',exact:true}));
    fireEvent.click(within(dialog).getByRole('button',{name:'Create folder',exact:true}));
    const created=JSON.parse(localStorage.getItem('dd-files-v1') || '[]').find((item:{name:string})=>item.name==='Travel plans');
    expect(created).toMatchObject({account:'work',color:'purple',folderStyle:'photos',type:'folder'});
  });
  it('opens Quick Look with Space and keeps the side pane details-only', async () => {
    native.invoke.mockImplementation(async () => ({configured:true,user}));
    launch(); await screen.findByRole('heading',{name:'Home',exact:true});
    fireEvent.click(screen.getByRole('button',{name:'Recent',exact:true}));
    const name=screen.getByRole('button',{name:'Website proposal.pdf',exact:true}); fireEvent.click(name);
    const pane=screen.getByRole('complementary',{name:'File inspector'});
    expect(within(pane).queryByText('No content attached')).toBeNull();
    fireEvent.keyDown(name.closest('tr')!,{key:' '});
    const modal=await screen.findByRole('dialog',{name:'Website proposal.pdf'});
    expect(within(modal).getByRole('heading',{name:'No preview available'})).toBeTruthy();
    fireEvent.keyDown(window,{key:'Escape'});
    expect(screen.queryByRole('dialog',{name:'Website proposal.pdf'})).toBeNull();
  });
});
