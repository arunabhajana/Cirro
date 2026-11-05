type Props={value:number|null;label:string;className?:string;meter?:boolean};
export default function ProgressBar({value,label,className='',meter=false}:Props){
 const amount=value===null?null:Number.isFinite(value)?Math.max(0,Math.min(100,value)):0;
 return <div className={`cirro-progress ${amount===null?'is-indeterminate':''} ${className}`} role={meter?'meter':'progressbar'} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={amount??undefined}><span className="cirro-progress-fill" style={amount===null?undefined:{width:`${amount}%`}}/></div>;
}
