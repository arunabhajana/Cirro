import {useEffect,useRef,useState} from 'react';
import {chooseOfflineLocation,getOfflineLocation,listOffline,removeOffline,saveOffline,useAppOfflineStorage,type OfflineRecord} from './native';
import type {MobileDriveFile} from '../drive/model';
export function useOfflineFiles(accounts:string[]){
  const [records,setRecords]=useState<OfflineRecord[]>([]);const [location,setLocation]=useState({name:'App storage',custom:false});const [busy,setBusy]=useState(false);const locked=useRef(false);const key=accounts.slice().sort().join(',');const currentAccounts=useRef(accounts);currentAccounts.current=accounts;const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function refresh(){const [files,place]=await Promise.all([listOffline(),getOfflineLocation()]);if(mounted.current){setRecords(files.filter(file=>currentAccounts.current.includes(file.account)));setLocation(place);}}
  useEffect(()=>{let active=true;Promise.all([listOffline(),getOfflineLocation()]).then(([files,place])=>{if(active){setRecords(files.filter(file=>accounts.includes(file.account)));setLocation(place);}}).catch(()=>{});return()=>{active=false;};},[key]);
  async function toggle(file:MobileDriveFile){if(locked.current)throw new Error('Wait for the current offline download to finish.');locked.current=true;setBusy(true);try{if(records.some(item=>item.key===file.id))await removeOffline(file.id);else await saveOffline(file);await refresh();}finally{locked.current=false;setBusy(false);}}
  async function choose(){const place=await chooseOfflineLocation();if(!place.cancelled)setLocation(place);}
  async function resetLocation(){setLocation(await useAppOfflineStorage());}
  return {records,location,busy,toggle,choose,resetLocation,refresh};
}
