const key = (scope:string) => `cirro-search-history:${scope}`;

export function readSearchHistory(scope:string, limit=6):string[]{
  try {
    const value=JSON.parse(localStorage.getItem(key(scope))||'[]');
    return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'&&item.trim().length>0).slice(0,limit):[];
  } catch { return []; }
}

export function saveSearchHistory(scope:string, query:string, limit=6):string[]{
  const clean=query.trim();
  const next=clean?[clean,...readSearchHistory(scope,limit).filter(item=>item!==clean)].slice(0,limit):readSearchHistory(scope,limit);
  try { localStorage.setItem(key(scope),JSON.stringify(next)); } catch { /* Local history is optional. */ }
  return next;
}

export function clearSearchHistory(scope:string){
  try { localStorage.removeItem(key(scope)); } catch { /* Local history is optional. */ }
}
