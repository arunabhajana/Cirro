export const accentColours=[
 {id:'blue',name:'Blue',light:'#087cf0',dark:'#66aaff'},
 {id:'violet',name:'Violet',light:'#7450d8',dark:'#b29aff'},
 {id:'teal',name:'Teal',light:'#087f7a',dark:'#65d5ca'},
 {id:'rose',name:'Rose',light:'#c54474',dark:'#ff94b9'},
 {id:'amber',name:'Amber',light:'#a86006',dark:'#efbb65'},
] as const;
export type VisualPreferences={accent:typeof accentColours[number]['id'];motion:'system'|'reduced';reduceTransparency:boolean};
export const defaultVisualPreferences:VisualPreferences={accent:'blue',motion:'system',reduceTransparency:false};
export function normalizeVisualPreferences(value:unknown):VisualPreferences{const data=value&&typeof value==='object'?value as Partial<VisualPreferences>:{};return {accent:accentColours.some(colour=>colour.id===data.accent)?data.accent!:'blue',motion:data.motion==='reduced'?'reduced':'system',reduceTransparency:data.reduceTransparency===true};}
export function applyVisualPreferences(value:VisualPreferences,dark:boolean){const colour=accentColours.find(colour=>colour.id===value.accent)||accentColours[0];const root=document.documentElement;root.dataset.accent=colour.id;root.dataset.motion=value.motion;root.dataset.transparency=value.reduceTransparency?'reduced':'full';root.style.setProperty('--accent',dark?colour.dark:colour.light);root.style.setProperty('--accent-solid',colour.light);root.style.setProperty('--surface-hover',`color-mix(in srgb, ${dark?colour.dark:colour.light} ${dark?'15':'9'}%, ${dark?'#20242c':'#ffffff'})`);}
