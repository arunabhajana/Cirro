import {useState,type Dispatch,type SetStateAction} from 'react';
export const widgetNames={storage:'Storage',composition:'File composition',recent:'Recent files',starred:'Starred',shared:'Shared files',offline:'Offline files',trash:'Trash',sync:'Sync status'};
export type WidgetId=keyof typeof widgetNames;
export const sectionNames={widgets:'Widgets',quick:'Quick actions',pinned:'Pinned'};
export type SectionId=keyof typeof sectionNames;
type Layout={sections:SectionId[];hidden:SectionId[];widgets:WidgetId[];enabled:WidgetId[]};
const defaults:Layout={sections:['widgets','quick','pinned'],hidden:[],widgets:Object.keys(widgetNames) as WidgetId[],enabled:['storage','composition','recent']};
export function normalizeLayout(value:Partial<Layout>|null):Layout {
  const order=<T extends string>(candidate:unknown,all:T[])=>[...new Set([...(Array.isArray(candidate)?candidate.filter((id):id is T=>all.includes(id)):[]),...all])];
  const sections=order(value?.sections,defaults.sections),widgets=order(value?.widgets,defaults.widgets);
  return {sections,widgets,hidden:Array.isArray(value?.hidden)?value.hidden.filter(id=>sections.includes(id)):[],enabled:Array.isArray(value?.enabled)?[...new Set(value.enabled.filter(id=>widgets.includes(id)))]:defaults.enabled};
}
function read(){try{const value=localStorage.getItem('cirro-home-layout-v3');if(value)return normalizeLayout(JSON.parse(value));const old=JSON.parse(localStorage.getItem('cirro-mobile-widgets-v2')||'null');return normalizeLayout(old?{enabled:[...(['storage','composition','starred'] as WidgetId[]).filter(id=>old[id]===true),'recent']}:null);}catch{return normalizeLayout(null);}}
export function move<T>(items:T[],id:T,direction:-1|1){const index=items.indexOf(id),next=index+direction;if(index<0||next<0||next>=items.length)return items;const copy=[...items];[copy[index],copy[next]]=[copy[next],copy[index]];return copy;}
type HomeState={layout:Layout;pins:string[];pinSort:'asc'|'desc'};
function readHomes():Record<string,HomeState>{try{const raw=JSON.parse(localStorage.getItem('cirro-homes-v4')||'null');if(raw&&typeof raw==='object'&&!Array.isArray(raw))return Object.fromEntries(Object.entries(raw).map(([id,value])=>{const home=value as Partial<HomeState>;return [id,{layout:normalizeLayout(home.layout||null),pins:Array.isArray(home.pins)?home.pins.filter(id=>typeof id==='string'):[],pinSort:home.pinSort==='desc'?'desc':'asc'}];}));}catch{}let pins:string[]=[];try{pins=JSON.parse(localStorage.getItem('cirro-mobile-pins')||'[]').filter((id:unknown)=>typeof id==='string');}catch{}return {all:{layout:read(),pins,pinSort:'asc'}};}
const fresh=():HomeState=>({layout:normalizeLayout(null),pins:[],pinSort:'asc'});
export function useHomeLayout(scope='all'){
 const [homes,setHomes]=useState(readHomes);const home=homes[scope]||fresh();
 function update(change:(home:HomeState)=>HomeState){setHomes(old=>{const next={...old,[scope]:change(old[scope]||fresh())};try{localStorage.setItem('cirro-homes-v4',JSON.stringify(next));}catch{}return next;});}
 const setLayout:Dispatch<SetStateAction<Layout>>=value=>update(old=>({...old,layout:typeof value==='function'?value(old.layout):value}));
 const setPins:Dispatch<SetStateAction<string[]>>=value=>update(old=>({...old,pins:typeof value==='function'?value(old.pins):value}));
 const setPinSort=(pinSort:'asc'|'desc')=>update(old=>({...old,pinSort}));
 return {...home,setLayout,setPins,setPinSort};
}
