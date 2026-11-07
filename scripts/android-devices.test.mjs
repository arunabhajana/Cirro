import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAdbDevices,selectAdbDevice,wirelessConnectTargets} from './android-devices.mjs';

test('accepts device details, whitespace and wireless serials',()=>{
  const output='List of devices attached\r\nabc\tdevice product:phone model:A063 transport_id:1\r\n192.168.1.2:5555 device model:phone\r\n';
  assert.equal(parseAdbDevices(output).length,2);
  assert.equal(selectAdbDevice(output,'abc'),'abc');
  assert.equal(selectAdbDevice('192.168.1.2:5555 device model:A063'),'192.168.1.2:5555');
});
test('gives different actionable errors for missing, unauthorized, offline and multiple devices',()=>{
  assert.throws(()=>selectAdbDevice('List of devices attached\n'),/cannot see a phone/);
  assert.throws(()=>selectAdbDevice('phone unauthorized usb:1'),/not authorized/);
  assert.throws(()=>selectAdbDevice('phone offline'),/offline/);
  assert.throws(()=>selectAdbDevice('one device\ntwo device'),/More than one/);
  assert.throws(()=>selectAdbDevice('one device','absent'),/ANDROID_SERIAL/);
});

test('discovers connection endpoints while excluding pairing ports and malformed targets',()=>{
  assert.deepEqual(wirelessConnectTargets('List of discovered mdns services\nphone _adb-tls-pairing._tcp 192.168.1.2:30000\nphone _adb-tls-connect._tcp 192.168.1.2:40000\nphone _adb-tls-connect._tcp 192.168.1.2:40000\nother _adb-tls-connect._tcp invalid'),['192.168.1.2:40000']);
});
