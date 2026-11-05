import fs from 'node:fs';
import path from 'node:path';
export const versionFiles=['package.json','package-lock.json','src-tauri/tauri.conf.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock'];
export function validateVersion(value){if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))throw Error('Use a stable version such as 1.0.1, without a v prefix or prerelease suffix.');return value;}
function cargoMatch(file,source){const expression=file.endsWith('.toml')?/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m:/\[\[package\]\]\r?\nname = "cirro"\r?\nversion = "([^"]+)"/;const match=expression.exec(source);if(!match)throw Error(`Cannot locate the Cirro package version in ${file}`);return match;}
export function readVersions(root=process.cwd()){return Object.fromEntries(versionFiles.map(file=>{const source=fs.readFileSync(path.join(root,file),'utf8');if(file.endsWith('.json')){const value=JSON.parse(source);return [file,value.version];}return [file,cargoMatch(file,source)[1]];}));}
export function checkVersions(root=process.cwd()){const versions=readVersions(root);const expected=validateVersion(versions['package.json']);const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));if(Object.values(versions).some(value=>value!==expected)||lock.packages?.['']?.version!==expected)throw Error(`Version mismatch. Run npm run version:bump -- ${expected}\n${JSON.stringify(versions,null,2)}`);return expected;}
export function nextVersion(current,input){validateVersion(current);if(['major','minor','patch'].includes(input)){const values=current.split('.').map(Number),index=['major','minor','patch'].indexOf(input);values[index]++;for(let i=index+1;i<3;i++)values[i]=0;return validateVersion(values.join('.'));}return validateVersion(input);}
export function updateVersions(version,{root=process.cwd(),dryRun=false}={}){
 validateVersion(version);
 // Parse and prepare every file before changing anything. Preserve unrelated package versions.
 const changes=versionFiles.map(file=>{const target=path.join(root,file);const before=fs.readFileSync(target,'utf8');let after;
 if(file.endsWith('.json')){const data=JSON.parse(before);data.version=version;if(file==='package-lock.json'){if(!data.packages?.[''])throw Error('Root package is missing from package-lock.json');data.packages[''].version=version;}after=JSON.stringify(data,null,2)+'\n';}
 else {const match=cargoMatch(file,before);const text=match[0];const replacement=text.replace(/(version\s*=\s*")[^"]+("\s*)$/,(_all,start,end)=>start+version+end);after=before.slice(0,match.index)+replacement+before.slice(match.index+text.length);}
 return {file,target,before,after};});
 if(dryRun)return changes.map(change=>change.file);
 const written=[];try{for(const change of changes){fs.writeFileSync(change.target,change.after);written.push(change);}checkVersions(root);}catch(error){for(const change of written.reverse())fs.writeFileSync(change.target,change.before);throw error;}
 return changes.map(change=>change.file);
}
