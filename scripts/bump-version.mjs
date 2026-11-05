import {checkVersions,nextVersion,readVersions,updateVersions} from './version-utils.mjs';
try{
 const [input,...flags]=process.argv.slice(2);
 if(input==='--check'){console.log(`All version files agree: ${checkVersions()}`);}
 else {if(!input||flags.some(flag=>flag!=='--dry-run'))throw Error('Usage: npm run version:bump -- <major|minor|patch|1.0.1> [--dry-run]');
 const current=readVersions()['package.json'];const version=nextVersion(current,input);const files=updateVersions(version,{dryRun:flags.includes('--dry-run')});console.log(`${flags.includes('--dry-run')?'Would update':'Updated'} Cirro ${current} → ${version}\n${files.map(file=>'  '+file).join('\n')}\nNo commit or tag was created.`);}
}catch(error){console.error(error.message);process.exitCode=1;}
