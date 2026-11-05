export const accountColors=['#579dff','#b58aff','#42c5a0','#f0ad55','#ee83aa','#59c4df','#df9870','#91bf65'];
export function validAccountColor(value:unknown):value is string{return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);}
