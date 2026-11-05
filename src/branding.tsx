import {useEffect} from 'react';
import {isTauri,invoke} from '@tauri-apps/api/core';
export function BrandLogo({className=''}:{className?:string}){return <img className={`cirro-logo ${className}`} src="/branding/cirro-transparent-128.png" alt="" draggable={false}/>;}
export function BrandSync(){useEffect(()=>{try{localStorage.removeItem('cirro-logo-style');}catch{}if(isTauri())void invoke('set_brand_icon').catch(()=>{});},[]);return null;}
