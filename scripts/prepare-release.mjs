import fs from 'node:fs';
const tag=process.env.GITHUB_REF_NAME||process.argv[2];
if(!/^v\d+\.\d+\.\d+$/.test(tag||''))throw Error('Use a stable tag such as v0.1.0 (three numbers, no prerelease suffix).');
const version=tag.slice(1);
for(const key of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','CIRRO_UPDATER_PUBLIC_KEY','TAURI_SIGNING_PRIVATE_KEY','TAURI_SIGNING_PRIVATE_KEY_PASSWORD'])if(!process.env[key])throw Error(`Missing release secret: ${key}`);
const repo=process.env.GITHUB_REPOSITORY;if(!/^[\w.-]+\/[\w.-]+$/.test(repo||''))throw Error('GITHUB_REPOSITORY is required');
const endpoint=`https://github.com/${repo}/releases/latest/download/latest.json`;
fs.appendFileSync(process.env.GITHUB_ENV,`CIRRO_UPDATE_ENDPOINT=${endpoint}\nCIRRO_UPDATER_PUBLIC_KEY=${process.env.CIRRO_UPDATER_PUBLIC_KEY.trim()}\n`);
for(const path of ['package.json','package-lock.json','src-tauri/tauri.conf.json']){const data=JSON.parse(fs.readFileSync(path));data.version=version;if(path.endsWith('tauri.conf.json')){data.plugins.updater.pubkey=process.env.CIRRO_UPDATER_PUBLIC_KEY.trim();data.plugins.updater.endpoints=[endpoint];}if(data.packages?.[''])data.packages[''].version=version;fs.writeFileSync(path,JSON.stringify(data,null,2)+'\n');}
for(const path of ['src-tauri/Cargo.toml','src-tauri/Cargo.lock']){let source=fs.readFileSync(path,'utf8');source=path.endsWith('.toml')?source.replace(/(\[package\][\s\S]*?\nversion = ")[^"]+("\n)/,`$1${version}$2`):source.replace(/(name = "cirro"\nversion = ")[^"]+("\n)/,`$1${version}$2`);fs.writeFileSync(path,source);}
console.log(`Preparing Cirro ${version} for ${repo}`);
