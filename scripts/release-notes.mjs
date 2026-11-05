import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export function loadReleaseNotes(version,root=projectRoot){
 if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Release notes require a stable version.');
 const file=path.join(root,'src','releases',`${version}.json`);
 if(!fs.existsSync(file))throw Error(`Add release notes in src/releases/${version}.json before tagging this version.`);
 const release=JSON.parse(fs.readFileSync(file,'utf8'));
 if(release.version!==version||!release.title||!release.summary||!Array.isArray(release.groups)||!release.groups.length)throw Error(`Invalid release notes for ${version}`);
 for(const group of release.groups)if(!group.title||!Array.isArray(group.items)||!group.items.length||group.items.some(item=>!item.title||!item.description))throw Error(`Incomplete release notes for ${version}`);
 return release;
}
export function renderReleaseNotes(release){
 return [`# ${release.title}`,`Cirro ${release.version}`,release.summary,...release.groups.map(group=>`## ${group.title}\n\n${group.items.map(item=>`- **${item.title}** — ${item.description}`).join('\n')}`),'## Install','Download the Windows installer below. Future updates are available from Cirro → Settings → About.'].join('\n\n')+'\n';
}
