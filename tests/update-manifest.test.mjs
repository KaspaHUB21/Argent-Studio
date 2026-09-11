import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createManifest} from '../scripts/update-manifest.mjs';
test('multi-platform updates retain Windows and select both native Mac archives',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'argent-feed-'));
 try {
  const artifacts={};for(const platform of ['windows-x86_64','darwin-aarch64','darwin-x86_64']){const file=path.join(directory,platform);fs.writeFileSync(file,'fixture');fs.writeFileSync(file+'.sig','fixture-signature');artifacts[platform]=file;}
  const options={version:'0.45.5',notes:'Changes',artifacts,required:Object.keys(artifacts)};
  const manifest=createManifest(options);
  assert.equal(Object.keys(manifest.platforms).length,3);
  assert.match(manifest.platforms['darwin-aarch64'].url,/macos-arm64\.app\.tar\.gz$/);
  assert.match(manifest.platforms['darwin-x86_64'].url,/macos-x64\.app\.tar\.gz$/);
  assert.match(manifest.platforms['windows-x86_64'].url,/windows-x64-setup\.exe$/);
  delete artifacts['windows-x86_64'];assert.throws(()=>createManifest(options),/Required update platform missing/);
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
