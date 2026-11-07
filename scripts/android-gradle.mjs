import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const task = process.argv[2];
if (!['assembleDebug', 'assembleRelease', 'signingReport'].includes(task)) throw new Error('Expected assembleDebug, assembleRelease or signingReport');
const env = { ...process.env };
if(task==='assembleRelease'&&['CIRRO_ANDROID_KEYSTORE_PATH','CIRRO_ANDROID_KEYSTORE_PASSWORD','CIRRO_ANDROID_KEY_ALIAS','CIRRO_ANDROID_KEY_PASSWORD'].some(key=>!env[key]))throw new Error('A signed Android release requires the CIRRO_ANDROID_KEYSTORE_PATH, CIRRO_ANDROID_KEYSTORE_PASSWORD, CIRRO_ANDROID_KEY_ALIAS and CIRRO_ANDROID_KEY_PASSWORD environment variables.');
const localJdkRoot = resolve('.qa/android-tools/jdk21');
const localJdk = existsSync(localJdkRoot) ? readdirSync(localJdkRoot).map(name => join(localJdkRoot, name)).find(path => existsSync(join(path, 'bin/java.exe'))) : undefined;
const studioJdk = 'C:/Program Files/Android/Android Studio/jbr';
// Recent Android Studio releases bundle Java 25; this Gradle 8 build needs 21.
// Prefer the verified project-local JDK when one was installed for this project.
if (localJdk) env.JAVA_HOME = localJdk;
if (!env.JAVA_HOME && existsSync(join(studioJdk, 'bin/java.exe'))) env.JAVA_HOME = studioJdk;
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || (env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Android/Sdk') : undefined);
if (sdk && existsSync(sdk)) env.ANDROID_HOME = sdk;
if (!env.JAVA_HOME) {
  console.error('Install Android Studio (with its bundled JDK), or set JAVA_HOME to JDK 21. See native/android/README.md.');
  process.exit(1);
}
const cwd = resolve('native/android');
const windows = process.platform === 'win32';
const result = windows
  ? spawnSync('cmd.exe', ['/d', '/c', 'gradlew.bat', task], { cwd, env, stdio: 'inherit' })
  : spawnSync('./gradlew', [task], { cwd, env, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
if (result.status === 0 && task === 'assembleDebug') {
  const artifacts = resolve('.qa/android-apks');
  mkdirSync(artifacts, { recursive: true });
  const name = env.CIRRO_ANDROID_LIVE === '1' ? 'Cirro-live-debug.apk' : 'Cirro-debug.apk';
  copyFileSync(join(cwd, 'app/build/outputs/apk/debug/app-debug.apk'), join(artifacts, name));
  console.log(`APK saved: ${join(artifacts, name)}`);
}
if(result.status===0&&task==='assembleRelease'){
  const artifacts=resolve('.qa/android-apks');
  mkdirSync(artifacts,{recursive:true});
  const destination=join(artifacts,'Cirro-android.apk');
  copyFileSync(join(cwd,'app/build/outputs/apk/release/app-release.apk'),destination);
  console.log(`Signed release APK saved: ${destination}`);
}
process.exit(result.status ?? 1);
