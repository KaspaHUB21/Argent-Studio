import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const source=new URL('../resources/toolchains/argent-master/',import.meta.url);
const provenanceUrl=new URL('../resources/toolchains/argent-provenance.json',import.meta.url);
const field=(block,name)=>block.match(new RegExp('^'+name+' = "([^"]+)"','m'))?.[1];

test('locked compiler and VM dependencies agree with bundled provenance without mixed Kaspa sources',async()=>{
 const provenance=JSON.parse(await readFile(provenanceUrl,'utf8'));
 const cargo=await readFile(new URL('Cargo.toml',source),'utf8');
 const lock=await readFile(new URL('Cargo.lock',source),'utf8');
 const packages=lock.split(/^\[\[package\]\]\s*$/m).slice(1).map(block=>({
  name:field(block,'name'),version:field(block,'version'),source:field(block,'source'),checksum:field(block,'checksum'),
 }));
 for(const name of ['silverscript-lang','silverscript-abi','silverscript-core']){
  const entries=packages.filter(pkg=>pkg.name===name);
  assert.equal(entries.length,1,`${name} must have one locked implementation`);
  assert.equal(entries[0].version,provenance.silverscript.version,`${name} version`);
  const revision=provenance.silverscript.revision;
  assert.equal(entries[0].source,`git+https://github.com/kaspanet/silverscript?rev=${revision}#${revision}`,`${name} immutable source`);
 }
 assert.equal(provenance.rustyKaspa.source,'crates.io');
 const kaspa=packages.filter(pkg=>pkg.name?.startsWith('kaspa-'));
 for(const name of ['kaspa-consensus-core','kaspa-txscript','kaspa-txscript-errors','kaspa-txscript-zk-sdk']){
  assert(kaspa.some(pkg=>pkg.name===name),`${name} must be present for compiler and VM`);
 }
 for(const pkg of kaspa){
  assert.equal(pkg.version,provenance.rustyKaspa.version,`${pkg.name} version`);
  if(pkg.name==='kaspa-hashes'){
   assert.equal(pkg.source,undefined,'only the explicitly restored kaspa-hashes crate may be a local source');
   continue;
  }
  assert.equal(pkg.source,'registry+https://github.com/rust-lang/crates.io-index',`${pkg.name} must not retain a competing Git implementation`);
  assert.match(pkg.checksum,/^[0-9a-f]{64}$/,`${pkg.name} registry archive integrity`);
 }
 for(const name of ['kaspa-consensus-core','kaspa-txscript','kaspa-txscript-errors']){
  const declaration=cargo.match(new RegExp('^'+name+' = (.+)$','m'))?.[1];
  assert.equal(declaration,`"=${provenance.rustyKaspa.version}"`,`${name} direct dependency must remain exact, not a floating compatible version`);
 }
 const spin=packages.filter(pkg=>pkg.name==='spin');
 assert(!spin.some(pkg=>pkg.version==='0.9.8'),'yanked spin 0.9.8 must not remain in this compiler/VM dependency graph');
});

test('Windows hash-crate restoration preserves registry bytes and immutable upstream assembly',async()=>{
 const vendor=new URL('../resources/toolchains/kaspa-hashes-2.1.0/',import.meta.url);
 const record=JSON.parse(await readFile(new URL('vendor-provenance.json',vendor),'utf8'));
 const provenance=JSON.parse(await readFile(provenanceUrl,'utf8'));
 assert.equal(record.package,'kaspa-hashes');assert.equal(record.version,provenance.rustyKaspa.version);
 assert.equal(record.crateSha256,'ad607d2d41c3ba426b5ecb48e3070d2783d71249ebda6132404b338e19f9025c','published registry archive');
 assert(Object.keys(record.originalFiles).length>=13,'registry source-file inventory must remain auditable');
 const sha=async relative=>createHash('sha256').update(await readFile(new URL(relative,vendor))).digest('hex');
 for(const [relative,digest] of Object.entries(record.originalFiles)){
  assert.equal(await sha(relative),digest,`${relative} must retain the published crate bytes`);
 }
 const vcs=JSON.parse(await readFile(new URL('.cargo_vcs_info.json',vendor),'utf8'));
 assert.equal(record.embeddedVcsRevision,vcs.git.sha1);
 assert.equal(record.embeddedVcsPubliclyResolvable,false,'embedded publication revision must not be represented as the restoration source');
 const restored=record.restoredFiles.find(file=>file.path==='src/asm/keccakf1600_x86-64-msvc.asm');
 assert(restored,'Windows MSVC assembly must be explicitly recorded');
 assert.equal(restored.sha256,'95bb94c219719d45020171d03745caa0983478bf69867947f6075ddae24e5f91');
 for(const file of record.restoredFiles){
  assert.equal(file.repository,'https://github.com/kaspanet/rusty-kaspa');
  assert.equal(file.revision,'01b532e8b553523216471682649693af92f0fd16');
  assert.equal(file.tag,`v${record.version}`);
  assert.equal(await sha(file.path),file.sha256,`${file.path} restoration integrity`);
 }
 const cargo=await readFile(new URL('Cargo.toml',source),'utf8');
 assert.match(cargo,/\[patch\.crates-io\][\s\S]*kaspa-hashes = \{ path = ['"]\.\.\/kaspa-hashes-2\.1\.0['"] \}/,'compiler and runtime use the audited restoration');
});
