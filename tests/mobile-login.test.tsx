import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const native = vi.hoisted(() => ({
  signInGoogle: vi.fn(), restoreGoogle: vi.fn(), signOutGoogle: vi.fn(), driveAccessToken: vi.fn(), forgetDriveToken: vi.fn(), DriveConsentRequired: class extends Error {},
  nativeAndroid: true, authError: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
vi.mock('../src/platforms/android/auth/nativeGoogle', () => native);
import MobileApp from '../src/platforms/android/MobileApp';
const ada = { id: 'ada', name: 'Ada Lovelace', email: 'ada@example.com', picture: 'https://lh3.googleusercontent.com/ada' };
const grace = { id: 'grace', name: 'Grace Hopper', email: 'grace@example.com', picture: 'https://lh3.googleusercontent.com/grace' };
beforeEach(() => {
  localStorage.clear(); vi.resetAllMocks();
  native.restoreGoogle.mockResolvedValue(null);
  native.driveAccessToken.mockRejectedValue(new native.DriveConsentRequired('Connect Drive to sync files.'));
  native.signOutGoogle.mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.scrollTo = vi.fn();
});
afterEach(cleanup);
async function login() {
  const button = await screen.findByRole('button', { name: 'Continue with Google' });
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole('button', { name: 'OK, continue' }));
  await screen.findByRole('heading', { name: 'Home' });
  fireEvent.click(await screen.findByRole('button',{name:'Not now'},{timeout:5000}));
}
async function settings() {
  const dismiss=screen.queryByRole('button',{name:'Not now'});if(dismiss)fireEvent.click(dismiss);
  fireEvent.click(screen.getByLabelText('More pages'));
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
}
it('shows real profiles in Settings and the switcher, adds and switches accounts, and signs out', async () => {
  native.signInGoogle.mockResolvedValueOnce(ada).mockResolvedValueOnce(grace);
  render(<MobileApp/>); await login();
  expect(screen.queryByText('Projects')).toBeNull();
  expect(screen.getByLabelText('Unified mode')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Switch account'));
  fireEvent.click(screen.getByRole('button',{name:/Ada Lovelace.*ada@example.com/}));
  expect(screen.getByLabelText('Switch account').querySelector('img')?.getAttribute('src')).toBe(ada.picture);
  expect(screen.getByLabelText('Switch account').className).toBe('m-profile-button');
  expect(screen.getByLabelText('Switch account').querySelectorAll('.m-avatar')).toHaveLength(1);
  await settings();
  expect(screen.getByRole('button',{name:/Ada Lovelace.*ada@example.com/})).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Need access/ }));
  expect(screen.getByLabelText('Google account email')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Switch account'));
  fireEvent.click(screen.getByRole('button', { name: 'Add Google account' }));
  await waitFor(() => expect(screen.getByText('2 Google accounts')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Sign out of all accounts' }));
  await screen.findByRole('button', { name: 'Continue with Google' });
  expect(native.signOutGoogle).toHaveBeenCalledOnce();
});
it('restores the last verified native session without prompting', async () => {
  native.restoreGoogle.mockResolvedValue(ada);
  render(<MobileApp/>);
  await screen.findByRole('heading', { name: 'Home' });
  expect(native.signInGoogle).not.toHaveBeenCalled();
});
it('keeps failed login on sign-in and allows retry', async () => {
  native.signInGoogle.mockRejectedValueOnce(new Error('Sign-in cancelled.')).mockResolvedValueOnce(ada);
  render(<MobileApp/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
  fireEvent.click(await screen.findByRole('button', { name: 'OK, continue' }));
  expect((await screen.findByRole('alert')).textContent).toContain('cancelled');
  await login();
});
it('does not remove the profile when native sign-out fails', async () => {
  native.restoreGoogle.mockResolvedValue(ada);
  native.signOutGoogle.mockRejectedValue(new Error('Sign-out failed.'));
  render(<MobileApp/>); await screen.findByRole('heading', { name: 'Home' });fireEvent.click(await screen.findByRole('button',{name:'Not now'},{timeout:5000})); await settings();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out of all accounts' }));
  await screen.findByText('Sign-out failed.');
  expect(screen.getByRole('button',{name:/Ada Lovelace.*ada@example.com/})).toBeTruthy();
});

it('opens Drive approval automatically and uses the same interactive connection flow as Sync',async()=>{
 native.signInGoogle.mockResolvedValue(ada);render(<MobileApp/>);fireEvent.click(await screen.findByRole('button',{name:'Continue with Google'}));
 fireEvent.click(await screen.findByRole('button',{name:'OK, continue'}));
 const dialog=await screen.findByRole('dialog',{name:'Allow Google Drive access'});expect(dialog.textContent).toContain(ada.email);
 fireEvent.click(screen.getByRole('button',{name:'Continue with Google'}));await waitFor(()=>expect(native.driveAccessToken).toHaveBeenCalledWith(ada.id,true));
 fireEvent.click(screen.getByRole('button',{name:'Not now'}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Allow Google Drive access'})).toBeNull());
 fireEvent.click(screen.getByLabelText('Notifications'));fireEvent.click(screen.getByLabelText('Close'));expect(screen.queryByRole('dialog',{name:'Allow Google Drive access'})).toBeNull();
});
