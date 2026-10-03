import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {COVENANT_SKILL} from '../frontend/covenant-skill.js';

test('bundled covenant instructions match their auditable document and actual dependency pins',async()=>{
 const document=await readFile(new URL('../resources/ai/covenants/SKILL.md',import.meta.url),'utf8');
 assert.equal(COVENANT_SKILL,document);
 const cargo=await readFile(new URL('../resources/toolchains/argent-master/Cargo.toml',import.meta.url),'utf8');
 for(const revision of ['3ed973335b59269293564805cc2c58a14595ec03','a41a333b08848f41bf737b72592e463a6011b8ac']){
  assert(cargo.includes(revision));assert(COVENANT_SKILL.includes(revision));
 }
 const root=new URL('../resources/toolchains/argent-master/',import.meta.url);
 for(const path of ['README.md','docs/argent-design.md','docs/icc-semantics.md','docs/security-invariants/README.md','docs/security-invariants/template-frame-identity.md','docs/security-invariants/leader-delegate-input-groups.md','examples/tickets.ag']){
  assert((await readFile(new URL(path,root),'utf8')).length>0);
 }
 assert(!/[A-Za-z]:[\\/]|Users\/|AppData/.test(COVENANT_SKILL),'no private host paths in model instructions');
});
test('AI instructions identify the exact bundled source provenance and locked dependencies',async()=>{
 const provenance=JSON.parse(await readFile(new URL('../resources/toolchains/argent-provenance.json',import.meta.url),'utf8'));
 assert.equal(provenance.argent.revision,'b312deda6fe10f6493c8d49eb748e3f61860458a');
 for(const revision of [provenance.argent.revision,provenance.silverscript.revision,provenance.rustyKaspa.revision]){
  assert.match(revision,/^[0-9a-f]{40}$/);assert(COVENANT_SKILL.includes(revision));
 }
 const lock=await readFile(new URL('../resources/toolchains/argent-master/Cargo.lock',import.meta.url));
 assert.equal(createHash('sha256').update(lock).digest('hex'),provenance.argent.cargoLockSha256,'lockfile drift requires updated provenance and review');
 assert(Array.isArray(provenance.adaptations)&&provenance.adaptations.length>0,'Studio adaptations must remain explicit');
 const source=await readFile(new URL('../resources/toolchains/argent-master/docs/security-invariants/leader-delegate-input-groups.md',import.meta.url),'utf8');
 assert(source.includes('Rule 5'));assert(source.includes('Rule 6'));
});
