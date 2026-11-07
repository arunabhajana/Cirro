export function parseAdbDevices(output) {
  return output.split(/\r?\n/).map(line=>line.trim()).filter(line=>line && !line.startsWith('List of devices') && !line.startsWith('*')).map(line=>{
    const [serial,state]=line.split(/\s+/);
    return {serial,state};
  }).filter(device=>['device','unauthorized','offline','recovery','sideload','bootloader'].includes(device.state));
}

export function wirelessConnectTargets(output) {
  return [...new Set(output.split(/\r?\n/).filter(line=>line.includes('_adb-tls-connect._tcp')).map(line=>line.trim().split(/\s+/).pop()).filter(value=>/^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[a-fA-F0-9:%]+\]):\d+$/.test(value || '')))];
}

export function selectAdbDevice(output,preferred) {
  const devices=parseAdbDevices(output);
  const ready=devices.filter(device=>device.state==='device');
  const target=preferred ? devices.find(device=>device.serial===preferred) : devices.length===1 ? devices[0] : undefined;
  if(target?.state==='device')return target.serial;
  if(target?.state==='unauthorized' || !preferred && !ready.length && devices.some(device=>device.state==='unauthorized'))throw new Error('Phone detected but not authorized. Unlock it and accept “Allow USB debugging?”, then retry.');
  if(target?.state==='offline')throw new Error('Phone detected but ADB reports it offline. Reconnect the cable and toggle USB debugging, then retry.');
  if(preferred)throw new Error('ANDROID_SERIAL does not match an authorized connected device. Check the device list or remove that environment variable.');
  if(ready.length===1)return ready[0].serial;
  if(ready.length>1)throw new Error('More than one device is ready. Set ANDROID_SERIAL to the phone you want to use, then retry.');
  if(devices.length)throw new Error('The phone is not in normal Android debugging mode. Boot it normally, enable USB debugging and retry.');
  throw new Error('ADB cannot see a phone. Connect a data-capable USB cable, unlock the phone, enable USB debugging and choose File transfer in its USB notification. If USB still fails, pair it through Android Studio → Pair Devices Using Wi-Fi.');
}
