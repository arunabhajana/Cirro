export function formatModified(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
export function modifiedParts(value:string):{date:string;time:string}{
  const date=new Date(value);
  if(!value||Number.isNaN(date.getTime()))return {date:'Unknown',time:''};
  return {date:date.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}),time:date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})};
}
