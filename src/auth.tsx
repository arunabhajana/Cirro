import AccountFlow,{type AccountFlowState} from './AccountFlow';
import {setConnections} from './ipc';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

export type GoogleUser = { id: string; name: string; email: string; picture: string | null };
type Status = { configured: boolean; user: GoogleUser | null };
type Phase = 'loading' | 'ready' | 'signing-in' | 'signing-out';
type Auth = Status & { users:GoogleUser[]; selectAccount:(id:string)=>Promise<void>; phase: Phase; error: string; desktop: boolean; signIn: () => Promise<void>; signOut: (id?:string) => Promise<void>; cancel: () => Promise<void>; retry: () => Promise<void> };
const AuthContext = createContext<Auth | null>(null);
const message = (error: unknown) => typeof error === 'string' ? error : 'Something went wrong with Google sign-in. Please try again.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const desktop = isTauri();
  const [status, setStatus] = useState<Status>({ configured: false, user: null });
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [users,setUsers]=useState<GoogleUser[]>([]);
  const [flow,setFlow]=useState<AccountFlowState|null>(null);const loadingUser=useRef<GoogleUser|null>(null);const flowGeneration=useRef(0);
  async function loadAccount(user:GoogleUser,generation:number){loadingUser.current=user;setFlow({stage:'loading',name:user.email,retry:'load'});try{await invoke('account_call',{account:user.id,command:'drive_sync',args:{}});if(generation!==flowGeneration.current){window.dispatchEvent(new Event('cirro-offline'));return;}await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{window.removeEventListener('cirro-workspace-ready',ready);reject(new Error('Drive synced, but the workspace did not finish loading. Try again.'));},30000);function ready(event:Event){const ids=(event as CustomEvent<string[]>).detail;if(!ids?.includes(user.id))return;clearTimeout(timer);window.removeEventListener('cirro-workspace-ready',ready);resolve();}window.addEventListener('cirro-workspace-ready',ready);window.dispatchEvent(new Event('cirro-offline'));});if(generation===flowGeneration.current)setFlow(null);}catch(reason){if(generation===flowGeneration.current)setFlow({stage:'error',name:user.email,error:reason instanceof Error?reason.message:String(reason),retry:'load'});}}
  async function retryFlow(){if(flow?.retry==='load'&&loadingUser.current){await loadAccount(loadingUser.current,++flowGeneration.current);}else await signIn();}
  function closeFlow(){flowGeneration.current++;setFlow(null);}
  async function connections(user:GoogleUser|null){const list=await invoke<GoogleUser[]>('auth_accounts');setUsers(list);setConnections(list,user?.id||'');}
  async function selectAccount(id:string){if(busy.current)return;busy.current=true;try{const user=await invoke<GoogleUser>('auth_activate',{id});await connections(user);setStatus({configured:true,user});}catch(error){setError(message(error));}finally{busy.current=false;}}
  useEffect(()=>{if(desktop&&phase==='ready')void connections(status.user).catch(error=>setError(message(error)));},[status.user?.id,phase]);
  const busy = useRef(false);
  // StrictMode mounts twice in development. Both reads are safe; ignore stale results.
  useEffect(() => {
    let active = true;
    if (!desktop) { setPhase('ready'); return; }
    invoke<Status>('auth_status').then(value => { if (active) setStatus(value); })
      .catch(reason => { if (active) setError(message(reason)); })
      .finally(() => { if (active) setPhase('ready'); });
    return () => { active = false; };
  }, [desktop]);
  async function retry() {
    if (!desktop || busy.current) return;
    busy.current = true; setPhase('loading'); setError('');
    try { setStatus(await invoke<Status>('auth_status')); }
    catch (reason) { setError(message(reason)); }
    finally { busy.current = false; setPhase('ready'); }
  }
  async function signIn() {
    if (!desktop || busy.current) return;
    busy.current = true; setError(''); setPhase('signing-in');const generation=++flowGeneration.current;setFlow({stage:'signing-in',retry:'signin'});
    try { const user=await invoke<GoogleUser>('auth_sign_in');await connections(user);setStatus({configured:true,user});setPhase('ready');await loadAccount(user,generation); }
    catch (reason) { if(reason==='Sign-in cancelled.'){if(generation===flowGeneration.current)setFlow(null);}else{setError(message(reason));if(generation===flowGeneration.current)setFlow({stage:'error',error:message(reason),retry:'signin'});} }
    finally { busy.current = false; setPhase('ready'); }
  }
  async function signOut(id?:string) {
    if (!desktop || busy.current) return;
    busy.current = true; setError(''); setPhase('signing-out');
    try { const user=await invoke<GoogleUser|null>('auth_remove',{id:id||status.user?.id});await connections(user);setStatus(value=>({...value,user})); }
    catch (reason) { setError(message(reason)); }
    finally { busy.current = false; setPhase('ready'); }
  }
  async function cancel() {
    if (phase !== 'signing-in') return;
    try { await invoke('auth_cancel');closeFlow(); } catch (reason) { setError(message(reason));setFlow({stage:'error',error:message(reason),retry:'signin'}); }
  }
  return <AuthContext.Provider value={{ ...status, users, selectAccount, phase, error, desktop, signIn, signOut, cancel, retry }}>{children}{flow&&<AccountFlow flow={flow} onCancel={()=>void cancel()} onRetry={()=>void retryFlow()} onClose={closeFlow}/>}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required');
  return value;
}
export function AccountAvatar({ user }: { user: GoogleUser }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [user.picture]);
  return <span className="google-account-avatar" aria-hidden="true">{user.picture && !failed
    ? <img src={user.picture} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
    : user.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'G'}</span>;
}
export function ConnectedAccount({ actions = true }: { actions?: boolean }) {
  const { user, signOut, phase } = useAuth();
  if (!user) return null;
  return <div className="google-account-card"><AccountAvatar user={user}/><div className="google-account-identity"><strong>{user.name}</strong><span>{user.email}</span><small>Connected with Google</small></div>{actions && <button className="secondary-button" disabled={phase === 'signing-out'} onClick={() => void signOut()}>{phase === 'signing-out' ? 'Signing out…' : 'Sign out'}</button>}</div>;
}
