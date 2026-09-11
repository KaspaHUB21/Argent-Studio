import {analyzeLive} from './live-analysis.js';
const MAX_IMPORTS=80,MAX_BYTES=2*1024*1024;
const normalize=value=>{const p=String(value||'').replaceAll('\\','/'),prefix=p.startsWith('/')?'/':p.match(/^[A-Za-z]:\//)?.[0];if(!prefix||p.startsWith('//'))return null;const parts=[];for(const part of p.slice(prefix.length).split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)return null;parts.pop();}else if(part.includes(':')||/[\0-\x1f]/.test(part))return null;else parts.push(part);}return prefix+parts.join('/');};
const key=p=>/^[A-Za-z]:\//.test(p)?p.toLowerCase():p;
const inside=(p,root)=>key(p)===key(root)||key(p).startsWith(key(root).replace(/\/$/,'')+'/');
const parent=p=>p.slice(0,p.lastIndexOf('/'))||'/';
function importsOf(source,analysis){
 const tokens=[...analysis.tokens,...analysis.ignored.filter(t=>t.value.startsWith('"'))].sort((a,b)=>a.from-b.from),imports=[];let depth=0;
 for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t.value==='{')depth++;else if(t.value==='}')depth--;if(depth!==0||t.value!=='import')continue;
  const actor=tokens[i+1]?.value==='actor',literal=tokens[i+(actor?4:1)],name=tokens[i+2];if(actor&&(name?.kind!=='name'||tokens[i+3]?.value!=='from'))continue;if(!literal?.value.startsWith('"')||tokens[i+(actor?5:2)]?.value!==';')continue;
  try{const spec=JSON.parse(literal.value);if(typeof spec==='string')imports.push({specifier:spec,kind:actor?'actor':'module',name:actor?name.value:null,from:literal.from+1,to:literal.to-1,nameFrom:name?.from,nameTo:name?.to});}catch{}
 }
 return imports;
}
function exportsOf(source,path,a){
 const symbols=[];
 for(const symbol of a.symbols){if(symbol.scope!==0)continue;const {name,kind,from,to,signature}=symbol;const out={name,kind,from,to,path};if(signature)out.signature=signature;
  const tokenIndex=a.tokens.findIndex(t=>t.from===from),body=a.scopes[symbol.bodyScope];
  if(kind==='fn'){
   out.params=(signature?.ranges||[]).map(r=>{const raw=signature.text.slice(r.from,r.to),match=raw.match(/^(.*?)\s+([A-Za-z_]\w*)$/);return match?{name:match[2],type:match[1].replace(/\s+/g,'')}:{name:raw,type:null};});
   const callable=a.callables.find(c=>c.symbol.id===symbol.id);if(callable){const after=a.tokens[callable.end+1];if(after?.value==='-'&&a.tokens[callable.end+2]?.value==='>'){const end=body?body.from-1:after.to;out.returnType=source.slice(a.tokens[callable.end+2].to,end).trim().replace(/\s+/g,'');}}
  }
  if(kind==='state'){
   out.baseState=a.tokens[tokenIndex+1]?.value==='expands'?a.tokens[tokenIndex+2]?.value:undefined;out.fields=[];
   if(body){const fieldTokens=a.tokens.filter(t=>body.from<=t.from&&t.to<=body.to);let start=0;for(let i=0;i<fieldTokens.length;i++){if(fieldTokens[i].value!==';')continue;const chunk=fieldTokens.slice(start,i),last=chunk.at(-1);if(last?.kind==='name'&&chunk.length>=2)out.fields.push({name:last.value,type:source.slice(chunk[0].from,last.from).trim().replace(/\s+/g,''),from:last.from,to:last.to});start=i+1;}}
  }
  if(kind==='actor')out.owns=a.tokens[tokenIndex+1]?.value==='owns'?a.tokens[tokenIndex+2]?.value:undefined;
  if(kind==='variable'){const previous=a.tokens[tokenIndex-1];out.type=previous?.value;out.kind='const';}
  symbols.push(out);
 }
 return symbols;
}
/** Reads only project-contained imports or the explicitly supplied standard-library file. */
export async function inspectLiveProject({path,text,documents=[],root,files=[],invoke,standardLibrary}){
 const current=normalize(path),project=normalize(root),standard=normalize(standardLibrary),diagnostics=[],symbols=[],seen=new Map();let complete=true,bytes=0,count=0;
 if(!current||!project||!inside(current,project))return {diagnostics,symbols,complete:false,hasImports:false};
 const buffers=new Map(documents.filter(d=>typeof d.text==='string').flatMap(d=>{const p=normalize(d.path);return p&&inside(p,project)?[[key(p),d.text]]:[];}));buffers.set(key(current),text);
 const addDiagnostic=(entry,code,de,en)=>diagnostics.push({code,severity:'error',from:entry.from,to:entry.to,messageDe:de,messageEn:en});
 async function read(target,isStandard){if(buffers.has(key(target)))return {status:'ok',text:buffers.get(key(target))};
  try{const boundary=isStandard?parent(standard):project,relative=target.slice(boundary.replace(/\/$/,'').length+1);const content=await invoke('read_ai_file',{projectRoot:boundary,path:relative,allowMissing:!isStandard});return content===null?{status:'missing'}:typeof content==='string'?{status:'ok',text:content}:{status:'restricted'};}catch{return {status:'restricted'};}
 }
 async function visit(target,source,trail,ownerEntry){
  const id=key(target);if(seen.has(id))return seen.get(id);if(count>=MAX_IMPORTS){complete=false;return [];}
  count++;bytes+=new TextEncoder().encode(source).length;if(bytes>MAX_BYTES){complete=false;return [];}
  const a=analyzeLive(source);if(a.diagnostics.length)complete=false;const own=exportsOf(source,target,a),all=[...own];seen.set(id,all);
  for(const entry of importsOf(source,a)){
   const isStandard=entry.specifier==='std::core';const imported=isStandard?standard:entry.specifier.includes('::')||/^(?:[A-Za-z]:|\/|\\)/.test(entry.specifier)?null:normalize(parent(target)+'/'+entry.specifier);
   if(!imported||(!isStandard&&!inside(imported,project))){complete=false;continue;}
   if(count>=MAX_IMPORTS&&!seen.has(key(imported))){complete=false;continue;}
   let available=seen.get(key(imported));
   if(!available){const result=await read(imported,isStandard);if(result?.status!=='ok'||typeof result.text!=='string'){complete=false;if(result?.status==='missing'&&target===current)addDiagnostic(entry,'import-missing',`Importdatei „${entry.specifier}“ wurde nicht gefunden.`,`Import file '${entry.specifier}' was not found.`);continue;}available=await visit(imported,result.text,[...trail,id],entry);}
   if(entry.kind==='actor'){
    const found=available.filter(s=>s.name===entry.name&&s.kind==='actor');if(found.length===1)all.push(found[0]);else if(!found.length&&complete&&target===current&&!trail.includes(key(imported))){addDiagnostic({...entry,from:entry.nameFrom,to:entry.nameTo},'import-name',`Akteur „${entry.name}“ ist in diesem Import nicht definiert.`,`Actor '${entry.name}' is not defined in this import.`);complete=false;}
   }else for(const s of available)if(!all.some(x=>x.path===s.path&&x.from===s.from))all.push(s);
  }
  return all;
 }
 const initial=analyzeLive(text),hasImports=importsOf(text,initial).length>0;
 const all=await visit(current,text,[],null);for(const s of all)if(key(s.path)!==key(current)&&!symbols.some(x=>x.path===s.path&&x.from===s.from))symbols.push(s);
 return {diagnostics,symbols,complete,hasImports};
}
