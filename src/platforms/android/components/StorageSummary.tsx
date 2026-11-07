import {formatGigabytes} from '../drive/model';
import { ChevronRight, HardDrive } from 'lucide-react';
export type StorageAccount = {id:string;name:string;email:string;color:string;used:number;total:number;known:boolean;unlimited:boolean};
export default function StorageSummary({accounts,onOpen}:{accounts:StorageAccount[];onOpen:()=>void}) {
  const known=accounts.filter(account=>account.known);
  const used=known.reduce((sum,account)=>sum+account.used,0);
  const total=known.reduce((sum,account)=>sum+account.total,0);
  const bounded=known.length>0 && known.every(account=>!account.unlimited);
  return <button className="m-widget m-storage-widget" onClick={onOpen}><span className="m-widget-title"><HardDrive size={20}/>Storage<ChevronRight size={16}/></span>
    {known.length>0 ? <><strong className="m-widget-number">{formatGigabytes(used)} <small>{bounded ? `of ${formatGigabytes(total)}` : 'used'}</small></strong><div className="m-storage-segments" aria-label="Storage used by account">{known.map(account=><i key={account.id} style={{width:`${total>0?Math.min(100,account.used/total*100):0}%`,background:account.color}}/>)}</div></> : <p className="m-pending-sync">Connect Drive to see storage usage.</p>}
    <div className="m-widget-accounts">{accounts.slice(0,2).map(account=><span key={account.id}><span className="m-storage-account-name"><i style={{background:account.color}}/>{account.name}</span><span>{account.known ? <><b>{formatGigabytes(account.used)} used</b><small>{account.unlimited?'No limit reported':`${formatGigabytes(Math.max(0,account.total-account.used))} left`}</small></> : <small>Not synced</small>}</span></span>)}</div>{accounts.length>2&&<small>+{accounts.length-2} more accounts · View storage</small>}
  </button>;
}
