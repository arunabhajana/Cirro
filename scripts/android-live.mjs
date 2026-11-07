import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {parseAdbDevices,selectAdbDevice,wirelessConnectTargets} from './android-devices.mjs';

const mode=process.argv[2] || 'start';
function runNodeScript(args,env=process.env) {
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env});
  if(result.error)throw result.error;if(result.status!==0)throw new Error(`Command failed (${result.status}).`);
}
if(mode==='build') {
  const env={...process.env,CIRRO_ANDROID_LIVE:'1'};
  try {
    runNodeScript(['scripts/prepare-assets.mjs'],env);
    runNodeScript(['node_modules/typescript/bin/tsc','--noEmit'],env);
    runNodeScript(['node_modules/vite/bin/vite.js','build','--config','vite.android.config.ts'],env);
    runNodeScript(['node_modules/@capacitor/cli/bin/capacitor','sync','android'],env);
    runNodeScript(['scripts/android-gradle.mjs','assembleDebug'],env);
  } finally {
    // Never leave a live-server URL in the normal native project config.
    const clean={...process.env};delete clean.CIRRO_ANDROID_LIVE;
    runNodeScript(['node_modules/@capacitor/cli/bin/capacitor','sync','android'],clean);
  }
  console.log('Live APK: .qa/android-apks/Cirro-live-debug.apk');
} else {
  const sdk=process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.LOCALAPPDATA || '', 'Android/Sdk');
  const adb=join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
  if(!existsSync(adb))throw new Error('Android platform-tools not found. Set ANDROID_HOME.');
  let listing=spawnSync(adb,['devices','-l'],{encoding:'utf8'});
  if(listing.error || listing.status!==0){console.error(listing.error?.message || listing.stderr || 'ADB could not run. Check Android platform-tools.');process.exit(1);}
  if(!process.env.ANDROID_SERIAL && parseAdbDevices(listing.stdout || '').length===0) {
    const discovery=spawnSync(adb,['mdns','services'],{encoding:'utf8',timeout:5000});
    const targets=wirelessConnectTargets(discovery.stdout || '');
    if(targets.length===1) {
      // ADB authenticates with the existing pairing key. Never pair a new phone
      // automatically, or guess which phone to use if several are advertised.
      console.log('Connecting to paired wireless device: '+targets[0]);
      spawnSync(adb,['connect',targets[0]],{stdio:'inherit',timeout:10000});
      listing=spawnSync(adb,['devices','-l'],{encoding:'utf8'});
    }
  }
  let serial;
  try {serial=selectAdbDevice(listing.stdout || '',process.env.ANDROID_SERIAL);}
  catch(error){console.error('\n'+error.message+'\n');console.error(listing.stdout);process.exit(1);}
  const command=(args)=>{const result=spawnSync(adb,['-s',serial,...args],{stdio:'inherit'});if(result.status!==0)throw new Error('ADB command failed.');};
  if(mode==='install') {
    const apk=resolve('.qa/android-apks/Cirro-live-debug.apk');
    if(!existsSync(apk))throw new Error('Run npm run android:live:apk first.');
    command(['install','-r',apk]);
    command(['reverse','tcp:1423','tcp:1423']);
  } else if(mode==='start') {
    command(['reverse','tcp:1423','tcp:1423']);
    const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1423','--strictPort'],{stdio:['inherit','pipe','pipe']});
    let started=false,ready=false;
    server.stdout.on('data',data=>{process.stdout.write(data);if(/ready in|Local:/.test(data.toString()))ready=true;});
    server.stderr.pipe(process.stderr);
    server.on('exit',()=>{if(!started)console.error('Vite could not start. Stop any other server on port 1423 and retry.');process.exitCode=server.exitCode || 0;});
    for(let attempt=0;attempt<30 && server.exitCode===null;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,300));
      if(!ready)continue;
      try { const response=await fetch('http://127.0.0.1:1423/android');if(response.ok){started=true;break;} }catch{}
    }
    if(started && server.exitCode===null) { command(['shell','am','force-stop','com.cirro.android']);command(['shell','am','start','-n','com.cirro.android/.MainActivity']);console.log('Live reload is running. Leave this terminal open; edit React/CSS normally.'); }
    if(!started){server.kill();throw new Error('Live-reload server failed to start. Check port 1423.');}
    const stop=()=>{server.kill();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  } else throw new Error('Expected build, install, or start.');
}
