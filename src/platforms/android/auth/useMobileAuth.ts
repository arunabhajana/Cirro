import {MAX_MOBILE_ACCOUNTS} from './accountLimits';
import { useEffect, useRef, useState } from 'react';
import { authError, nativeAndroid, restoreGoogle, signInGoogle, signOutGoogle } from './nativeGoogle';
import type { MobileUser } from './googleIdentity';
import {restoreAccountProfiles,saveAccountProfile,clearAccountProfiles,removeAccountProfile} from './accountProfiles';

export function useMobileAuth() {
  const [users, setUsers] = useState<MobileUser[]>([]);
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(nativeAndroid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  useEffect(() => {
    let active = true;
    Promise.all([restoreAccountProfiles().catch(()=>[]),restoreGoogle().catch(()=>null)]).then(async([saved,profile]) => {
      if(!active)return;
      let selected='';try{selected=localStorage.getItem('cirro-active-account')||'';}catch{}
      const candidates=[...saved.filter(item=>item.id!==profile?.id),...(profile?[profile]:[])];
      // Preserve the selected identity when upgrading installations with more than three profiles.
      const preferred=[selected,profile?.id].filter(Boolean);
      const retained=candidates.length>MAX_MOBILE_ACCOUNTS?[...preferred.flatMap(id=>candidates.find(item=>item.id===id)||[]),...candidates]:candidates;
      const all=[...new Map(retained.map(item=>[item.id,item])).values()].slice(0,MAX_MOBILE_ACCOUNTS);
      await Promise.all(saved.filter(item=>!all.some(kept=>kept.id===item.id)).map(item=>removeAccountProfile(item.id).catch(()=>{})));
      if(profile&&all.some(item=>item.id===profile.id))await saveAccountProfile(profile).catch(()=>{});
      if(!active)return;setUsers(all);setUser(all.find(item=>item.id===selected)||all.find(item=>item.id===profile?.id)||all[0]||null);
    }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function signIn() {
    if (locked.current || loading) return false;
    locked.current = true; setBusy(true); setError('');
    try {
      if (users.length >= MAX_MOBILE_ACCOUNTS) throw new Error('Up to three accounts can be connected on Android. Disconnect an account before adding another.');
      const profile = await signInGoogle();
      await saveAccountProfile(profile);try{localStorage.setItem('cirro-active-account',profile.id);}catch{}
      setUsers(old => [...old.filter(item => item.id !== profile.id), profile]); setUser(profile);
      return true;
    } catch (reason) { setError(authError(reason)); return false; }
    finally { locked.current = false; setBusy(false); }
  }
  function select(id: string) { if (locked.current) return; const profile = users.find(item => item.id === id); if (profile) {setUser(profile);try{localStorage.setItem('cirro-active-account',id);}catch{}}  }
  async function signOut() {
    if (locked.current) return false;
    locked.current = true; setBusy(true); setError('');
    try { await signOutGoogle(); await clearAccountProfiles();try{localStorage.removeItem('cirro-active-account');}catch{}setUsers([]); setUser(null); return true; }
    catch (reason) { setError(authError(reason)); return false; }
    finally { locked.current = false; setBusy(false); }
  }
  async function remove(id:string) {if(locked.current)return false;locked.current=true;setBusy(true);setError('');try{await removeAccountProfile(id);const next=users.filter(profile=>profile.id!==id);setUsers(next);if(user?.id===id){const replacement=next[0]||null;setUser(replacement);try{if(replacement)localStorage.setItem('cirro-active-account',replacement.id);else localStorage.removeItem('cirro-active-account');}catch{}}return true;}catch(reason){setError(authError(reason));return false;}finally{locked.current=false;setBusy(false);}}
  return { user, users, remove, loading, busy, error, signIn, select, signOut, native: nativeAndroid };
}
