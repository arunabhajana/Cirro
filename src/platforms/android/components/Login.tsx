
import { ArrowRight, X } from 'lucide-react';
import {useState} from 'react';
import AccessRequest from './AccessRequest';

export default function Login({ onPreview, onSignIn, busy = false, loading = false, error = '', native = false }: { onPreview: () => void; onSignIn: () => void; busy?: boolean; loading?: boolean; error?: string; native?: boolean }) {
  const [confirming,setConfirming]=useState(false);
  return <div className="m-app m-login">
    <header className="m-topbar"><span className="m-brand"><img src="/branding/cirro-transparent-128.png" alt=""/>Cirro</span><span className="m-login-badge">Early access</span></header>
    <main>
      <div className="m-login-intro"><img src="/branding/cirro-transparent.png" alt=""/><h1>Your Drive.<br/>All together.</h1><p>Sign in to access your files and Google accounts in Cirro.</p></div>
      <div className="m-login-actions"><button className="m-google-button" onClick={()=>setConfirming(true)} disabled={busy || loading} aria-busy={busy || loading}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.25c1.9-1.75 2.97-4.33 2.97-7.35Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.42l-3.25-2.51c-.9.6-2.05.96-3.36.96-2.6 0-4.8-1.76-5.59-4.13H3.05v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.9a6 6 0 0 1 0-3.8V7.5H3.05a10 10 0 0 0 0 9l3.36-2.6Z"/><path fill="#EA4335" d="M12 5.97c1.47 0 2.79.51 3.82 1.51l2.86-2.86A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.5l3.36 2.6A5.99 5.99 0 0 1 12 5.97Z"/></svg>{loading ? 'Checking account…' : busy ? 'Signing in…' : 'Continue with Google'}</button>
      {error && <p className="m-login-status" role="alert">{error}</p>}<p className="m-login-note">Google accounts need approval during early access.</p>
      {!native && <button className="m-preview-link" onClick={onPreview}>Explore UI preview <ArrowRight size={17}/></button>}</div>
      <AccessRequest/>
      <footer className="m-login-footer">{native ? 'Cirro for Android' : 'Android preview · Sample files and accounts'}</footer>
    </main>
    {confirming&&<dialog className="m-login-confirm" open aria-modal="true" aria-labelledby="m-login-confirm-title"><header><h2 id="m-login-confirm-title">Cirro early access</h2><button aria-label="Close" onClick={()=>setConfirming(false)}><X size={20}/></button></header><p>Your Google account needs to be enabled as a test user before you can sign in. If it hasn’t been approved yet, request access first.</p><AccessRequest/><footer><button className="m-wide-link" onClick={()=>setConfirming(false)}>Go back</button><button className="m-primary" disabled={!native||busy||loading} onClick={()=>{setConfirming(false);onSignIn();}}>OK, continue <ArrowRight size={17}/></button></footer></dialog>}
  </div>;
}
