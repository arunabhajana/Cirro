import {useState} from 'react';
export const accountColours=['#8e6bd1','#007aff','#2c9267','#c44b7a','#c17b19','#5e859c'];
export type AccountPreference={label:string;color:string};
export function useAccountPreferences(){
 const [preferences,setPreferences]=useState<Record<string,AccountPreference>>(()=>{try{return JSON.parse(localStorage.getItem('cirro-account-preferences-v1')||'{}');}catch{return {};}});
 function update(id:string,patch:Partial<AccountPreference>){setPreferences(old=>{const next={...old,[id]:{label:old[id]?.label||'',color:old[id]?.color||accountColours[0],...patch}};try{localStorage.setItem('cirro-account-preferences-v1',JSON.stringify(next));}catch{}return next;});}
 return {preferences,update};
}
