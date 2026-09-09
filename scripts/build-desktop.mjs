// Build the self-contained desktop binary; native helper binaries must match this OS.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, CARGO_HOME: path.join(root, '.cargo') };
const run = (exe, args) => { const r = spawnSync(exe, args, { cwd: root, env, stdio: 'inherit' }); if (r.error) throw r.error; if (r.status !== 0) process.exit(r.status || 1); };
const helper = path.join(root, 'resources/bin', process.platform === 'win32' ? 'argentc.exe' : 'argentc');
if (!existsSync(helper)) throw new Error('Native compiler missing: run node scripts/build-runtime.mjs on this platform first.');
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
const debug = process.argv.includes('--debug');
run('cargo', ['build', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--features', 'custom-protocol', ...(debug ? [] : ['--release'])]);
console.log(`Desktop binary: ${path.join(root, 'src-tauri/target', debug ? 'debug' : 'release', 'argent-studio-tauri' + (process.platform === 'win32' ? '.exe' : ''))}`);
console.log('For an installer/application bundle: node node_modules/@tauri-apps/cli/tauri.js build');
