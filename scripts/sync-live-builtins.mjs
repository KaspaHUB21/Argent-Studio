import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {KEYWORDS,PRIMITIVE_TYPES,BUILTINS}=require('../resources/assets/language/argent-service.js');
const target=new URL('../frontend/live-builtins.js',import.meta.url);
const source='// Generated from the pinned Argent language service. Run node scripts/sync-live-builtins.mjs.\n'+
 'export const keywords = '+JSON.stringify(KEYWORDS,null,2)+';\n'+
 'export const types = '+JSON.stringify(PRIMITIVE_TYPES,null,2)+';\n'+
 'export const builtins = '+JSON.stringify(BUILTINS.map(({name,signature,params})=>({name,signature,params})),null,2)+';\n';
if(process.argv.includes('--check')){
 if(readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Live editor builtins are out of sync with the pinned language service.');
}else writeFileSync(target,source);
