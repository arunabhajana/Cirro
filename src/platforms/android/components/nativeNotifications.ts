import {Capacitor,registerPlugin} from '@capacitor/core';
const plugin=registerPlugin<{status():Promise<{granted:boolean}>;request():Promise<{granted:boolean}>;openSettings():Promise<void>;notify(options:{id:number;title:string;message:string;silent?:boolean;shared?:boolean;kind?:string}):Promise<void>;progress(options:{id:number;title:string;message:string;progress:number;total:number;done:boolean;failed?:boolean}):Promise<void>}>('CirroNotifications');
export const nativeNotificationsAvailable=()=>Capacitor.isNativePlatform()&&Capacitor.isPluginAvailable('CirroNotifications');
export const notificationStatus=async()=>nativeNotificationsAvailable()?plugin.status():{granted:false};
export const requestNativeNotifications=async()=>{if(!nativeNotificationsAvailable())throw new Error('Android notifications require the updated APK.');return plugin.request();};
export const openNotificationSettings=async()=>{if(nativeNotificationsAvailable())await plugin.openSettings();};
export const postNativeNotification=async(options:Parameters<typeof plugin.notify>[0])=>{if(nativeNotificationsAvailable())await plugin.notify(options);};
export const nativeTransferProgress=async(options:Parameters<typeof plugin.progress>[0])=>{if(nativeNotificationsAvailable())await plugin.progress(options);};
