import fs from 'node:fs';
import path from 'node:path';
const files=process.argv.slice(2);
if(!files.length)throw Error('Pass unpacked application and helper binaries to scan.');
let failed=false;
for(const file of files){const bytes=fs.readFileSync(file);let hit=false;for(const encoding of ['latin1','utf16le']){const text=bytes.toString(encoding);if(/[A-Z]:[\\/]Users[\\/][^\\/\x00]+[\\/]|\/(?:Users|home)\/[^/\x00]+\//i.test(text)){hit=true;break;}}console.log(path.basename(file)+': '+(hit?'FAIL: personal build path detected':'PASS'));failed ||= hit;}
if(failed)process.exitCode=1;
