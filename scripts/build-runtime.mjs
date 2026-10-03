import './configure-build.mjs';
// Build native helpers for the current OS from this application's copied sources.
// Requires Rust >= 1.94, platform C/C++ build tools and Node >= 22.
import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'resources/toolchains/argent-master');
const bin = path.join(root, 'resources/bin');
const suffix = process.platform === 'win32' ? '.exe' : '';
const env = { ...process.env, CARGO_HOME: path.join(root, '.cargo'), CARGO_TARGET_DIR: path.join(root, '.runtime-target') };
if(process.platform==='darwin')env.MACOSX_DEPLOYMENT_TARGET ||= '13.5';
mkdirSync(path.join(bin, 'runtime'), { recursive: true });
for (const args of [['build', '--locked', '--release', '--bin', 'argentc'], ['build', '--locked', '--release', '--example', 'studio_test']]) {
  const result = spawnSync('cargo', args, { cwd: source, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const [from, to] of [[path.join(env.CARGO_TARGET_DIR, 'release', `argentc${suffix}`), path.join(bin, `argentc${suffix}`)], [path.join(env.CARGO_TARGET_DIR, 'release/examples', `studio_test${suffix}`), path.join(bin, `ArgentTestRunner-v1${suffix}`)], [process.execPath, path.join(bin, 'runtime', `node${suffix}`)]]) {
  copyFileSync(from, to);
  if (process.platform !== 'win32') chmodSync(to, 0o755);
}
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const provenance = JSON.parse(readFileSync(path.join(root, 'resources/toolchains/argent-provenance.json'), 'utf8'));
const lockHash = sha256(path.join(source, 'Cargo.lock'));
if (lockHash !== provenance.argent.cargoLockSha256) throw new Error('Argent source lockfile differs from recorded provenance.');
const receipt = {
  builtAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  toolchain: provenance,
  bridgeSha256: sha256(path.join(source, 'examples/studio_test.rs')),
  binaries: {
    compiler: { path: `argentc${suffix}`, sha256: sha256(path.join(bin, `argentc${suffix}`)) },
    testRunner: { path: `ArgentTestRunner-v1${suffix}`, sha256: sha256(path.join(bin, `ArgentTestRunner-v1${suffix}`)) },
    node: { path: `runtime/node${suffix}`, sha256: sha256(path.join(bin, 'runtime', `node${suffix}`)) },
  },
};
writeFileSync(path.join(bin, 'toolchain-build.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(`Native Argent compiler, test runner and Node runtime prepared for ${process.platform}/${process.arch}.`);
