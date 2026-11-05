import {cpSync,existsSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const source=dirname(require.resolve('pdfjs-dist/package.json'));
const destination=fileURLToPath(new URL('../public/pdfjs/',import.meta.url));
mkdirSync(destination,{recursive:true});
for(const name of ['cmaps','standard_fonts','wasm','LICENSE']){
 const path=join(source,name);
 if(!existsSync(path))throw new Error(`Missing PDF.js asset: ${name}. Run npm ci first.`);
 cpSync(path,join(destination,name),{recursive:true,force:true});
}
console.log('Prepared PDF.js runtime assets and licenses from the installed dependency.');
