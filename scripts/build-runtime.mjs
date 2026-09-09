// Build native helpers for the current OS from this application's copied sources.
// Requires Rust >= 1.94, platform C/C++ build tools and Node >= 22.
import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'resources/toolchains/argent-master');
const bin = path.join(root, 'resources/bin');
const suffix = process.platform === 'win32' ? '.exe' : '';
const env = { ...process.env, CARGO_HOME: path.join(root, '.cargo'), CARGO_TARGET_DIR: path.join(root, '.runtime-target') };
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
console.log(`Native Argent compiler, test runner and Node runtime prepared for ${process.platform}/${process.arch}.`);
