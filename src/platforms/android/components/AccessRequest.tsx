import { useId, useState } from 'react';
import { Mail, ArrowUpRight } from 'lucide-react';

export function accessRequestUrl(email: string) {
  return `mailto:arunabhajana@gmail.com?subject=${encodeURIComponent('Cirro test access request')}&body=${encodeURIComponent(`Hello,\n\nPlease approve this Google account for Cirro test access:\n${email.trim()}\n\nThank you.`)}`;
}

export default function AccessRequest() {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [prepared, setPrepared] = useState(false);
  return <section className="m-access" aria-label="Request early access">
    <button className="m-access-heading" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}><span><strong>Need access?</strong><small>Request approval for your Google account.</small></span><Mail size={21}/></button>
    {expanded && <form id={id} onSubmit={event => { event.preventDefault(); setPrepared(true); window.location.href = accessRequestUrl(email); }}>
      <label htmlFor={`${id}-email`}>Google account email</label>
      <input id={`${id}-email`} type="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setPrepared(false); }}/>
      <p>Opens a request to arunabhajana@gmail.com in your email app. Review and send it to request approval.</p>
      <button className="m-primary" type="submit" disabled={!email.trim()}>Prepare email request <ArrowUpRight size={18}/></button>
      {prepared && <p role="status">Your email app should open. Send the prepared email to finish. If it didn’t open, email arunabhajana@gmail.com with your Google account address.</p>}
    </form>}
  </section>;
}
