import StorageUsageBar from './StorageUsageBar';
import {ChevronRight,HardDrive} from 'lucide-react';
import {accounts} from './data';
export default function StorageWidget({scope,order,onManage}:{scope:string;order:number;onManage:()=>void}){
  const selected=accounts.filter(account=>scope==='all'||account.id===scope);
  const used=selected.reduce((sum,account)=>sum+account.used,0);
  const known=selected.every(account=>account.total>0)&&selected.length>0;
  const total=selected.reduce((sum,account)=>sum+account.total,0);
  const percent=total?Math.round(used/total*100):0;
  return <section className="widget deck-storage" style={{order}}><div className="section-title"><h3>Storage</h3><button className="text-button" onClick={onManage}>Manage<ChevronRight size={14}/></button></div><div className="deck-storage-summary"><span className="deck-storage-symbol"><HardDrive size={22}/></span><div><strong>{known?`${Math.max(0,total-used).toFixed(1)} GB`:'—'}</strong><span>{known?'available':'Storage limit unavailable'}</span></div><span className="deck-storage-percent">{known?`${percent}% used`:''}</span></div><StorageUsageBar accounts={selected}/><div className="deck-storage-caption"><span>{used.toFixed(1)} GB used</span><span>{known?`${total.toFixed(1)} GB total`:'Google Drive'}</span></div><div className="deck-storage-accounts">{selected.map(account=><div className="deck-storage-account" key={account.id}><span className="deck-account-dot" style={{background:account.color}}/><span title={account.email}><strong>{account.name}</strong><small>{account.email}</small></span><span>{account.used.toFixed(1)}<small> / {account.total>0?account.total.toFixed(1):'—'} GB</small></span></div>)}</div></section>;
}
