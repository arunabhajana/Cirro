import {Capacitor,registerPlugin,type PluginListenerHandle} from '@capacitor/core';
export type AndroidRelease={version:string;url:string;sha256:string;size:number;notes:string};
export type AppBuild={version:string;versionCode:number;wasUpdated:boolean;openUpdates?:boolean;ready?:AndroidRelease};
export type UpdateProgress={bytes:number;total:number;phase:string};
const native=registerPlugin<{info():Promise<AppBuild>;check():Promise<{available:boolean;published:boolean;release?:AndroidRelease}>;download(options:{release:AndroidRelease}):Promise<{ready:boolean}>;cancel():Promise<void>;install():Promise<{needsPermission:boolean}>;addListener(event:'progress',callback:(value:UpdateProgress)=>void):Promise<PluginListenerHandle>}>('AndroidUpdates');
export const updatesAvailable=()=>Capacitor.isNativePlatform()&&Capacitor.isPluginAvailable('AndroidUpdates');
export {native as androidUpdates};
