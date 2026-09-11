// Conservative local binding diagnostics. Never infer missing imported definitions.
import {keywords,types,builtins} from './live-builtins.js';
const reserved=new Set([...keywords,...types,...builtins.map(x=>x.name),'require','assert','let','for','while','break','continue','unrestricted']);
const distance=(a,b)=>{let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]!==b[j])));row=next;}return row[b.length];};
export function analyzeSemantics(text,a,project={}) {
 if(a.diagnostics.length)return [];
 const out=[],ts=a.tokens, imported=project.symbols||[],hasImports=project.hasImports??ts.some(t=>t.value==='import');
 const complete=!hasImports||project.complete===true;
 const inside=(scope,parent)=>{for(let s=scope;s!==null;s=a.scopes[s]?.parent??null)if(s===parent)return true;return false;};
 const callableAt=pos=>a.callables.find(c=>{const s=a.scopes[c.symbol.bodyScope];return s.from<=pos&&pos<s.to;});
 const declared=new Map(a.symbols.filter(s=>s.kind!=='field').map(s=>[s.from,s]));
 const locals=[...declared.values()];
 // Imported state types are not necessarily known by the lexical analysis.
 const knownTypes=new Set([...types,...locals.filter(s=>['state','enum'].includes(s.kind)).map(s=>s.name),...imported.filter(s=>['state','enum','type'].includes(s.kind)).map(s=>s.name)]);
 for(let i=0;i<ts.length;i++){if(!knownTypes.has(ts[i].value))continue;let j=i+1;while(ts[j]?.value==='['&&a.pairs.has(j))j=a.pairs.get(j)+1;if(ts[j]?.kind!=='name'||!['=',';'].includes(ts[j+1]?.value)||declared.has(ts[j].from)||!callableAt(ts[j].from))continue;const s={id:'semantic:'+ts[j].from,name:ts[j].value,from:ts[j].from,to:ts[j].to,scope:a.scopeAt(ts[j].from),kind:'variable'};locals.push(s);declared.set(s.from,s);}
 const actorFields=new Map();
 for(const actor of a.symbols.filter(s=>s.kind==='actor')){const index=ts.findIndex(t=>t.from===actor.from),stateName=ts[index+1]?.value==='owns'?ts[index+2]?.value:null,names=new Set(),visited=new Set();let name=stateName;while(name&&!visited.has(name)){visited.add(name);const importedState=imported.find(s=>s.name===name&&s.kind==='state');if(importedState){for(const f of importedState.fields||[])names.add(f.name);name=importedState.baseState;continue;}const state=a.symbols.find(s=>s.name===name&&s.kind==='state');if(!state)break;for(const f of a.symbols.filter(s=>s.scope===state.bodyScope&&s.kind==='variable'))names.add(f.name);const si=ts.findIndex(t=>t.from===state.from);name=ts[si+1]?.value==='expands'?ts[si+2]?.value:null;}actorFields.set(actor.bodyScope,names);}
 const inheritedField=(name,scope)=>[...actorFields].some(([parent,names])=>inside(scope,parent)&&names.has(name));
 const aliases=new Map();
 for(const c of a.callables){const names=new Set(),body=a.scopes[c.symbol.bodyScope];for(let i=c.end+1;i<ts.length&&ts[i].from<body.from;i++)if(ts[i].kind==='name'&&(ts[i+1]?.value===':'||['observes','spawns','as'].includes(ts[i-1]?.value)))names.add(ts[i].value);aliases.set(c,names);}
 const resolve=(t,i)=>a.resolve(t.value,t.from,i)||locals.filter(s=>s.name===t.value&&s.from<=t.from&&inside(a.scopeAt(t.from),s.scope)).sort((x,y)=>a.scopes[y.scope].depth-a.scopes[x.scope].depth)[0];
 const uses=new Map();
 for(let i=0;i<ts.length;i++){const t=ts[i];if(t.kind!=='name'||declared.has(t.from)||ts[i+1]?.value===':'||ts[i-1]?.value==='.'&&ts[i-2]?.value!=='self')continue;const s=resolve(t,i);if(s)uses.set(s.id,(uses.get(s.id)||0)+1);}
 const emit=(s,code,severity,de,en,extra={})=>out.push({code,severity,from:s.from,to:s.to,messageDe:de,messageEn:en,...extra});
 const groups=new Map();for(const s of locals){const k=s.scope+':'+s.name;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(s);}
 for(const group of groups.values())if(group.length>1)for(const s of group)emit(s,'duplicate-definition','error',`„${s.name}“ ist in diesem Bereich mehrfach definiert.`,`'${s.name}' is defined more than once in this scope.`,{related:group.filter(x=>x!==s).map(x=>({from:x.from,to:x.to,labelDe:'Andere Definition',labelEn:'Other definition'}))});
 for(const s of locals){const c=callableAt(s.from)||a.callables.find(c=>s.kind==='parameter'&&c.symbol.bodyScope===s.scope);if(!c||!['variable','parameter'].includes(s.kind)||groups.get(s.scope+':'+s.name).length>1)continue;
  // Parameters may also be referenced in observes/spawns headers, outside their body scope.
  const headerUsed=s.kind==='parameter'&&ts.some(t=>t.from>ts[c.end].to&&t.to<=a.scopes[c.symbol.bodyScope].from&&t.value===s.name);
  if(!uses.get(s.id)&&!headerUsed&&!s.name.startsWith('_'))emit(s,'unused-binding','hint',`„${s.name}“ wird nicht verwendet.`,`'${s.name}' is not used.`,{fade:true});
  const shadow=a.symbols.find(x=>x.name===s.name&&x.scope!==s.scope&&inside(s.scope,x.scope)&&(x.kind!=='variable'||x.from<s.from));
  if(shadow)emit(s,'shadowed-binding','warning',`„${s.name}“ verdeckt einen Namen aus einem äußeren Bereich.`,`'${s.name}' shadows a name from an outer scope.`,{related:[{from:shadow.from,to:shadow.to,labelDe:'Verdeckte Definition',labelEn:'Shadowed definition'}]});
 }
 if(!complete)return out;
 for(let i=0;i<ts.length;i++){const t=ts[i],c=callableAt(t.from);if(!c||t.kind!=='name'||declared.has(t.from)||reserved.has(t.value)||knownTypes.has(t.value)||inheritedField(t.value,a.scopeAt(t.from))||ts[i-1]?.value==='.'||ts[i-1]?.value===':'||ts[i+1]?.value===':'||aliases.get(c)?.has(t.value)||imported.some(s=>s.name===t.value)||resolve(t,i))continue;
  // Only complete statements. A partially typed final line must remain quiet.
  let end=i;for(;end<ts.length&&ts[end].value!==';'&&ts[end].value!=='}';end++);if(ts[end]?.value!==';')continue;
  // Leave unknown type declarations and their bindings to the compiler.
  if(ts[i+1]?.kind==='name'||ts[i-1]?.kind==='name'&&!['return','require'].includes(ts[i-1].value))continue;
  const candidates=[...new Set([...locals.filter(s=>inside(a.scopeAt(t.from),s.scope)&&(s.kind!=='variable'||s.from<t.from)).map(s=>s.name),...imported.map(s=>s.name),...builtins.map(s=>s.name)])].filter(n=>n!==t.value&&Math.abs(n.length-t.value.length)<=1&&distance(n,t.value)===1);
  const suggestion=candidates.length===1?candidates[0]:null;
  emit(t,'unknown-name','warning',`Unbekannter Name „${t.value}“.${suggestion?` Meintest du „${suggestion}“?`:''}`,`Unknown name '${t.value}'.${suggestion?` Did you mean '${suggestion}'?`:''}`,suggestion?{fix:{from:t.from,to:t.to,insert:suggestion,labelDe:`Durch „${suggestion}“ ersetzen`,labelEn:`Replace with '${suggestion}'`}}:{});
 }
 return out;
}
