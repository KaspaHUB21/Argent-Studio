import {stringify as stringifyLossless} from 'lossless-json';

// Keep the verification snapshot local; reports sent to the model contain only results.
export function createProjectVerifier(context) {
 const verified = new WeakMap();
 const normalize = path => String(path || '').replaceAll('\\', '/');
 const key = path => context.isWindows?.() ? normalize(path).toLowerCase() : normalize(path);
 function relative(root, path) {
  let value = normalize(path), base = normalize(root).replace(/\/$/, '');
  if (key(value).startsWith(key(base) + '/')) value = value.slice(base.length + 1);
  if (!base || !value.endsWith('.ag') || value.includes(':') || value.startsWith('/') || value.split('/').some(p => !p || p.startsWith('.') || /[. ]$/.test(p))) throw Error('Project-relative .ag path required.');
  return value;
 }
 function access(root, epoch) {
  if (!context.isSharing() || !context.getSettings()?.aiEnabled || context.getProjectRoot() !== root || context.getAccessEpoch() !== epoch) throw Error('Project code access disabled or project changed.');
 }
 async function capture(root, epoch, proposal) {
  access(root, epoch);
  const revision = context.getRevision?.();
  const docs = context.getDocuments().filter(d => !d.generated && key(d.path).startsWith(key(normalize(root).replace(/\/$/, '')) + '/') && /\.ag$/.test(d.path));
  const paths = new Map();
  for (const file of context.getFiles()) if (!file.isDirectory && /\.ag$/.test(file.path)) { const p = relative(root, file.path); paths.set(key(p), p); }
  for (const doc of docs) { const p = relative(root, doc.path); paths.set(key(p), p); }
  if (proposal?.path) { const p = relative(root, proposal.path); paths.set(key(p), p); }
  if (paths.size > 128) throw Error('AI verification supports at most 128 source files.');
  const sources = [], baselines = [];
  let total = 0;
  for (const path of [...paths.values()].sort()) {
   access(root, epoch);
   const doc = docs.find(d => key(relative(root, d.path)) === key(path));
   const proposed = proposal?.path && key(relative(root, proposal.path)) === key(path);
   const disk = await context.invoke('read_ai_file', {projectRoot:root, path, allowMissing:!!doc || !!proposed});
   access(root, epoch);
   const baseline = doc ? doc.text : disk;
   if (baseline === null && !proposed) throw Error('Source file no longer exists: ' + path);
   const content = proposed ? proposal.content : baseline;
   if (typeof content !== 'string' || content.length > 160000) throw Error('File exceeds AI context limit.');
   total += new TextEncoder().encode(content).length;
   if (total > 2000000) throw Error('AI verification snapshot exceeds 2 MB.');
   sources.push({path,content}); baselines.push({path,content:baseline,disk});
  }
  access(root, epoch);
  if (context.getRevision?.() !== revision) throw Error('Project changed while collecting verification sources.');
  return {sources,baselines};
 }
 async function unchanged(snapshot) {
  try {
   access(snapshot.root, snapshot.epoch);
   if (context.getRevision?.() !== snapshot.revision || context.getEntry() !== snapshot.selectedEntry || context.getAppName() !== snapshot.appName) return false;
   const current = await capture(snapshot.root, snapshot.epoch, snapshot.proposal);
   return JSON.stringify(current.baselines) === JSON.stringify(snapshot.baselines);
  } catch { return false; }
 }
 async function verify(proposal = {}) {
  const root = context.getProjectRoot(), epoch = context.getAccessEpoch();
  access(root, epoch);
  const selectedEntry = context.getEntry(), appName = context.getAppName();
  const active = context.getDocument()?.path;
  const entry = relative(root, selectedEntry || active || proposal.path);
  const frozenProposal = proposal.path ? {path:relative(root,proposal.path),content:proposal.content} : undefined;
  const {sources,baselines} = await capture(root, epoch, frozenProposal);
  if (!sources.some(s => key(s.path) === key(entry))) throw Error('Build entry is not in the project snapshot.');
  const snapshot = {root,epoch,revision:context.getRevision?.(),selectedEntry,appName,proposal:frozenProposal,baselines};
  if (!await unchanged(snapshot)) throw Error('Project changed before verification.');
  const result = await context.invoke('verify_ai_proposal', {sources,entry,appName,scenariosJson:stringifyLossless(proposal.scenarios || [])});
  access(root, epoch);
  if (!await unchanged(snapshot)) throw Error('Project changed during verification. Request a fresh proposal.');
  verified.set(result,snapshot);
  return result;
 }
 return {verify,check: result => verified.has(result) ? unchanged(verified.get(result)) : Promise.resolve(false)};
}
