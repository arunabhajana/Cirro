import {Capacitor,registerPlugin} from '@capacitor/core';
import {Fingerprint,ShieldCheck} from 'lucide-react';
import {useEffect,useState} from 'react';

type BiometricPlugin={getEnabled():Promise<{enabled:boolean}>;setEnabled(options:{enabled:boolean}):Promise<{enabled:boolean}>;isAvailable():Promise<{available:boolean;reason?:string}>;authenticate():Promise<void>};
const biometric=registerPlugin<BiometricPlugin>('BiometricLock');
const native=()=>Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android'&&Capacitor.isPluginAvailable('BiometricLock');

export function useBiometricLock(){
 const [ready,setReady]=useState(!native()),[available,setAvailable]=useState(false),[enabled,setEnabled]=useState(false),[locked,setLocked]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;if(!native())return;Promise.all([biometric.isAvailable(),biometric.getEnabled()]).then(([status,saved])=>{if(!active)return;setAvailable(status.available);setEnabled(saved.enabled&&status.available);setLocked(saved.enabled&&status.available);if(saved.enabled&&!status.available)setError(status.reason||'Biometric unlock is unavailable on this device.');}).catch(()=>{if(active)setError('Biometric unlock could not be prepared.');}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
 useEffect(()=>{if(!enabled)return;const onVisibility=()=>{if(document.visibilityState==='hidden')setLocked(true);};document.addEventListener('visibilitychange',onVisibility);return()=>document.removeEventListener('visibilitychange',onVisibility);},[enabled]);
 async function set(value:boolean){setError('');if(!native())return;if(value){const status=await biometric.isAvailable();if(!status.available){setAvailable(false);setError(status.reason||'Set up a fingerprint or face unlock in Android settings first.');return;}}const saved=await biometric.setEnabled({enabled:value});setEnabled(saved.enabled);setLocked(saved.enabled);}
 async function unlock(){setError('');try{await biometric.authenticate();setLocked(false);}catch{setError('Unlock cancelled. Use your device biometric to continue.');}}
 return {ready,available,enabled,locked,error,set,unlock};
}

export function BiometricSettings({lock}:{lock:ReturnType<typeof useBiometricLock>}){return <div className="m-biometric-settings"><div className="m-biometric-hero"><span><Fingerprint size={27}/></span><div><h3>App lock</h3><p>Require your fingerprint or face unlock whenever Cirro returns to the foreground.</p></div></div>{lock.error&&<p className="m-settings-note">{lock.error}</p>}<button role="switch" aria-checked={lock.enabled} disabled={!lock.available&&!lock.enabled} onClick={()=>void lock.set(!lock.enabled)}><span><strong>Use biometric unlock</strong><small>{lock.enabled?'Cirro locks when it leaves the screen':lock.available?'Keep your connected drives private':'Set up biometrics in Android settings first'}</small></span><span className={'m-switch '+(lock.enabled?'on':'')}/></button></div>}

export function BiometricGate({lock}:{lock:ReturnType<typeof useBiometricLock>}){return <div className="m-biometric-gate" role="dialog" aria-modal="true" aria-label="Unlock Cirro"><img src="/branding/cirro-transparent-128.png" alt="Cirro"/><span className="m-biometric-mark"><ShieldCheck size={27}/></span><h1>Unlock Cirro</h1><p>Your connected Google accounts stay protected on this device.</p>{lock.error&&<p className="m-biometric-error" role="alert">{lock.error}</p>}<button className="m-primary" onClick={()=>void lock.unlock()}><Fingerprint size={19}/>Unlock with biometrics</button></div>}
