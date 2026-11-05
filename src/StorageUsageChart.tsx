import StorageUsageBar from './StorageUsageBar';
type Account={id:string;name:string;used:number;total:number;color:string};
const clean=(value:number)=>Number.isFinite(value)?Math.max(0,value):0;
const amount=(value:number)=>`${value.toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1})} GB`;
export default function StorageUsageChart({accounts}:{accounts:Account[]}){
 const values=accounts.map(account=>({...account,used:clean(account.used),total:clean(account.total)}));
 const used=values.reduce((sum,account)=>sum+account.used,0),total=values.reduce((sum,account)=>sum+account.total,0);
 const known=values.length>0&&values.every(account=>account.total>0);const available=Math.max(0,total-used);
 return <section className="drive-storage-summary" aria-labelledby="drive-storage-title">
  <header><h3 id="drive-storage-title">Google account storage</h3><p>{values.length===1?`Storage for ${values[0].name}.`:'Storage across your connected accounts.'}</p></header>
  {values.length?<><div className="drive-storage-totals"><div><strong>{amount(used)}</strong><span>used{known?` · ${Math.round(used/total*100)}%`:''}</span></div><div><span>Total capacity</span><strong>{known?amount(total):'Unavailable'}</strong></div></div>
  <StorageUsageBar accounts={values}/>
  <ul className="drive-storage-legend" aria-label="Storage breakdown">{values.map(account=><li key={account.id}><i style={{background:account.color}}/><span title={account.name}>{account.name}</span><strong>{amount(account.used)}</strong></li>)}{known&&<li><i className="storage-available-dot"/><span>Available</span><strong>{amount(available)}</strong></li>}</ul>
  <p className="drive-storage-note">{known?'Includes Google Drive, Gmail and Google Photos usage reported by Google.':'Capacity unavailable for one or more accounts. The bar shows each account’s share of used storage.'}</p></>:<p className="drive-storage-note">Connect an account to see its storage usage.</p>}
 </section>;
}
