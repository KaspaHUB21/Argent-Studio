// Restore files for inspection only; transactions must use a fresh build.
export async function readProjectBuild(root, invoke) {
  const join = (...parts) => parts.join('/').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const projectEntries = await invoke('list_directory', {path:root});
  if (!projectEntries.some(f => f.isDirectory && f.name === 'build')) return null;
  const entries = await invoke('list_directory', {path: join(root, 'build')});
  const directories = entries.filter(f => f.isDirectory && /^\d+$/.test(f.name))
    .sort((a,b) => BigInt(a.name) === BigInt(b.name) ? 0 : BigInt(a.name) > BigInt(b.name) ? -1 : 1);
  const output = directories[0]?.path || (entries.some(f => f.name === 'artifact.json') ? join(root, 'build') : null);
  if (!output) return null;
  const files = [];
  async function collect(path, depth=0) {
    if (depth > 16) throw Error('Build directory nesting limit exceeded');
    for (const file of await invoke('list_directory', {path})) {
      if (file.isDirectory) await collect(file.path, depth+1);
      else files.push(file);
    }
  }
  await collect(output);
  if (!files.length) return null;
  const read = name => {
    const file = files.find(f => join(output, name) === f.path.replace(/\\/g, '/'));
    return file ? invoke('read_file', {path:file.path}) : Promise.resolve('');
  };
  let artifact = null;
  try { artifact = JSON.parse(await read('artifact.json')); } catch { /* Keep incomplete build files available. */ }
  let stdout = '';
  try { stdout = await read('editor-build.log'); } catch { /* The log is optional. */ }
  return {output, files, artifact, artifactPath:join(output,'artifact.json'), stdout,
    success:!!artifact && files.some(f => f.name === 'manifest.json'), stale:true, restored:true};
}
