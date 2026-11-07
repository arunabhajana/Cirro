import { useEffect, useState } from 'react';
import type { MobileUser } from '../auth/googleIdentity';

export default function ProfileAvatar({ user, large = false }: { user: Pick<MobileUser, 'name' | 'picture'>; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [user.picture]);
  return <span className={`m-avatar ${large ? 'large' : ''}`} aria-hidden="true">{user.picture && !failed ? <img src={user.picture} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : user.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'G'}</span>;
}
