import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';

// Share only the debug APK, never the repository or local OAuth configuration.
const routes = {
  '/cirro.apk': resolve('.qa/android-apks/Cirro-debug.apk'),
  '/cirro-live.apk': resolve('.qa/android-apks/Cirro-live-debug.apk'),
};
const server = createServer((request, response) => {
  const apk=Object.hasOwn(routes,request.url) ? routes[request.url] : undefined;
  if (!['GET', 'HEAD'].includes(request.method) || !apk || !existsSync(apk)) {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Download Cirro at /cirro.apk');
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${request.url==='/cirro-live.apk'?'Cirro-live-debug.apk':'Cirro-debug.apk'}"`,
    'Content-Length': statSync(apk).size,
    'Cache-Control': 'no-store',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(apk).on('error', () => response.destroy()).pipe(response);
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(1430, '0.0.0.0', () => {
  console.log('Cirro APK download (same Wi-Fi; keep this terminal running):');
  for (const entry of Object.values(networkInterfaces()).flat()) {
    if (entry && entry.family === 'IPv4' && !entry.internal) console.log(`http://${entry.address}:1430/cirro.apk`);
  }
});
