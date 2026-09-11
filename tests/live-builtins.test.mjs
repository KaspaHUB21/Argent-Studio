import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('live editor builtin metadata matches the pinned language service',()=>{
 execFileSync(process.execPath,['scripts/sync-live-builtins.mjs','--check'],{cwd:new URL('..',import.meta.url)});
});
