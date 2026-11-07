import { Capacitor,registerPlugin } from '@capacitor/core';
import type { MobileUser } from './googleIdentity';
const vault=registerPlugin<{listProfiles():Promise<{profiles:MobileUser[]}>;saveProfile(options:{profile:MobileUser}):Promise<void>;clearProfiles():Promise<void>;removeProfile(options:{id:string}):Promise<void>;authorizeSilently(options:{id:string}):Promise<{token:string}>}>('AccountVault');
const available=()=>Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AccountVault');
export async function restoreAccountProfiles(){if(!available())return [];return (await vault.listProfiles()).profiles.filter(profile=>typeof profile.id==='string'&&typeof profile.email==='string'&&typeof profile.name==='string');}
export async function saveAccountProfile(profile:MobileUser){if(available())await vault.saveProfile({profile});}
export async function removeAccountProfile(id:string){if(available())await vault.removeProfile({id});}
export async function clearAccountProfiles(){if(available())await vault.clearProfiles();}
export async function silentAccountToken(id:string){if(!available())return null;return (await vault.authorizeSilently({id})).token;}
