// Conservative, browser-local lexical assistance. The compiler remains authoritative.
import {types as primitiveTypes,builtins,keywords} from './live-builtins.js';
const types = new Set(primitiveTypes);
const builtinSignatures=new Map(builtins.map(b=>{const start=b.signature.indexOf('(')+1,end=b.signature.indexOf(')',start);let offset=start;const ranges=b.signature.slice(start,end).split(',').filter(p=>p.trim()).map(p=>{const leading=p.length-p.trimStart().length,r={from:offset+leading,to:offset+p.trimEnd().length};offset+=p.length+1;return r;});return [b.name,{text:b.signature,ranges}];}));
const named = new Set(['app','actor','state','enum','fn','entry','delegate']);
const controls = new Set(['if','else','for','while']);
export function analyzeLive(text) {
 const tokens=[],ignored=[],diagnostics=[],stack=[],pairs=new Map();
 const pattern=/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|0[xX][0-9a-fA-F]+|[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g;
 for(const m of text.matchAll(pattern)) { const value=m[0],token={from:m.index,to:m.index+value.length,value,kind:/^[A-Za-z_]/.test(value)?'name':'punctuation'}; if(/^(\/\/|\/\*|["'])/.test(value)){ignored.push(token);continue;} tokens.push(token); }
 let unfinishedLiteral=false;for(const token of ignored){const v=token.value,quote=v[0],slashes=(v.slice(0,-1).match(/\\+$/)?.[0].length||0);if((quote==='\"'||quote==="'")&&(v.length===1||v.at(-1)!==quote||slashes%2)){unfinishedLiteral=true;diagnostics.push({code:'unclosed',from:token.from,to:token.from+1,messageDe:'Zeichenfolge ist noch nicht geschlossen.',messageEn:'String literal is not closed.'});}else if(v.startsWith('/*')&&!v.endsWith('*/')){unfinishedLiteral=true;diagnostics.push({code:'unclosed',from:token.from,to:token.from+2,messageDe:'Blockkommentar ist noch nicht geschlossen.',messageEn:'Block comment is not closed.'});}}
 const closing={'(':')','[':']','{':'}'},opening={')':'(',']':'[','}':'{'};
 for(let i=0;i<tokens.length;i++){const t=tokens[i]; if(closing[t.value])stack.push(i);else if(opening[t.value]){if(stack.length&&tokens[stack.at(-1)].value===opening[t.value]){const j=stack.pop();pairs.set(j,i);pairs.set(i,j);}else diagnostics.push({code:'unexpected-close',from:t.from,to:t.to,messageDe:`Unerwartete schließende Klammer „${t.value}“.`,messageEn:`Unexpected closing delimiter '${t.value}'.`,fix:{from:t.from,to:t.to,insert:'',labelDe:'Überzählige Klammer entfernen',labelEn:'Remove unexpected delimiter'}});}}
 if(!unfinishedLiteral)for(const i of stack){const t=tokens[i];diagnostics.push({code:'unclosed',from:t.from,to:t.to,messageDe:`Schließende Klammer „${closing[t.value]}“ fehlt.`,messageEn:`Missing closing delimiter '${closing[t.value]}'.`});}
 const scopes=[{from:0,to:text.length,parent:null,depth:0}],scopeAtToken=[],braceScopes=new Map();let active=[0];
 for(let i=0;i<tokens.length;i++){const t=tokens[i];scopeAtToken[i]=active.at(-1);if(t.value==='{'){const id=scopes.length;scopes.push({from:t.to,to:pairs.has(i)?tokens[pairs.get(i)].from:text.length,parent:active.at(-1),depth:active.length});braceScopes.set(i,id);active.push(id);}else if(t.value==='}'&&active.length>1){active.pop();}}
 const ownedScopes=new Map();
 const symbols=[],declarations=new Map(),blocks=[],callables=[];const knownTypes=new Set(types);
 const add=(index,scope,kind,extra={})=>{if(declarations.has(index))return declarations.get(index);const t=tokens[index];const s={id:symbols.length,name:t.value,from:t.from,to:t.to,scope,kind,...extra};symbols.push(s);declarations.set(index,s);return s;};
 const findBody=start=>{let j=start;while(j<tokens.length){const v=tokens[j].value;if(v===';'||v==='}'||(named.has(v)&&tokens[j+1]?.kind==='name'))return null;if(['observes','spawns'].includes(v)){while(j<tokens.length&&tokens[j].value!=='{'&&![';','}'].includes(tokens[j].value))j++;if(!pairs.has(j))return null;j=pairs.get(j)+1;continue;}if(v==='{'){const prev=tokens[j-1]?.value;if(['emits','consumes','observes','inputs','outputs'].includes(prev)){if(!pairs.has(j))return null;j=pairs.get(j)+1;continue;}return j;}j++;}return null;};
 for(let i=0;i<tokens.length;i++){if(!named.has(tokens[i].value)||tokens[i+1]?.kind!=='name')continue;const kind=tokens[i].value,nameIndex=i+1; if(tokens[i-1]?.value==='import')continue;
  const body=findBody(i+2);if(body===null)continue;const parent=scopeAtToken[i],bodyScope=braceScopes.get(body);if(bodyScope===undefined)continue;
  const s=add(nameIndex,parent,kind,{bodyScope});if(kind==='actor'&&tokens[i+2]?.value==='owns'&&tokens[i+3]?.kind==='name')ownedScopes.set(bodyScope,tokens[i+3].value);if(['state','enum'].includes(kind))knownTypes.add(s.name);
  blocks.push({from:tokens[body].from,to:pairs.has(body)?tokens[pairs.get(body)].to:text.length,label:kind+' '+s.name,headerFrom:tokens[i].from,headerTo:tokens[body].from});
  if(['fn','entry','delegate'].includes(kind)&&tokens[i+2]?.value==='('&&pairs.has(i+2)){
   const open=i+2,end=pairs.get(open),params=[];let start=open+1;
   for(let j=start;j<=end;j++){if(j!==end&&['(','[','{'].includes(tokens[j].value)&&pairs.has(j)){j=pairs.get(j);continue;}if(j===end||tokens[j].value===','){const chunk=tokens.slice(start,j),last=chunk.at(-1);if(last?.kind==='name'&&chunk.length>=2){add(j-1,bodyScope,'parameter');params.push(text.slice(chunk[0].from,last.to).trim());}start=j+1;}}
   const signature=s.name+'('+params.join(', ')+')';let offset=s.name.length+1;const ranges=params.map(p=>{const r={from:offset,to:offset+p.length};offset+=p.length+2;return r;});s.signature={text:signature,ranges};callables.push({symbol:s,open,end});
  }
 }
 const parameterHeaders=[];for(let i=0;i<tokens.length;i++)if(['fn','entry','delegate'].includes(tokens[i].value)&&tokens[i+2]?.value==='(')parameterHeaders.push([i+2,pairs.get(i+2)??tokens.length]);
 for(let i=0;i<tokens.length;i++){if(!knownTypes.has(tokens[i].value)||parameterHeaders.some(([start,end])=>start<i&&i<end))continue;let j=i+1;while(tokens[j]?.value==='['&&pairs.has(j))j=pairs.get(j)+1;
  if(tokens[j]?.kind!=='name'||!['=',';',',',')'].includes(tokens[j+1]?.value))continue;
  const prev=tokens[i-1]?.value;if(prev==='.'||prev==='->')continue; if(declarations.has(j))continue;
  const scope=scopeAtToken[j];add(j,scope,'variable');
 }
 for(const [scope,stateName] of ownedScopes){const states=symbols.filter(s=>s.kind==='state'&&s.name===stateName);if(states.length===1){const fields=symbols.filter(s=>s.scope===states[0].bodyScope&&s.kind==='variable');for(const field of fields)symbols.push({...field,scope,kind:'field'});}}
 for(let i=0;i<tokens.length;i++){if(tokens[i].value!=='{'||!braceScopes.has(i)||blocks.some(b=>b.from===tokens[i].from))continue;let j=i-1;if(tokens[j]?.value===')'&&pairs.has(j))j=pairs.get(j)-1;if(controls.has(tokens[j]?.value))blocks.push({from:tokens[i].from,to:pairs.has(i)?tokens[pairs.get(i)].to:text.length,label:text.slice(tokens[j].from,tokens[i].from).trim().replace(/\s+/g,' '),headerFrom:tokens[j].from,headerTo:tokens[i].from});}
 const scopeAt=pos=>{let best=0;for(let i=1;i<scopes.length;i++)if(scopes[i].from<=pos&&pos<=scopes[i].to&&scopes[i].depth>scopes[best].depth)best=i;return best;};
 const symbolIndex=new Map();for(const symbol of symbols){const key=symbol.scope+':'+symbol.name;if(!symbolIndex.has(key))symbolIndex.set(key,[]);symbolIndex.get(key).push(symbol);}
 const hasBinding=(name,pos)=>{let scope=scopeAt(pos);while(scope!==null){if((symbolIndex.get(scope+':'+name)||[]).some(s=>s.kind!=='variable'||s.from<=pos))return true;scope=scopes[scope].parent;}return false;};
 const resolve=(name,pos,index=-1)=>{if(declarations.has(index))return declarations.get(index);if(index>=0&&tokens[index+1]?.value===':')return null;let scope=index>=0?scopeAtToken[index]:scopeAt(pos);if(index>=0&&tokens[index-1]?.value==='.'){if(tokens[index-2]?.value!=='self')return null;while(scope!==null){const fields=(symbolIndex.get(scope+':'+name)||[]).filter(s=>s.kind==='field');if(fields.length===1)return fields[0];scope=scopes[scope].parent;}return null;}while(scope!==null){const found=(symbolIndex.get(scope+':'+name)||[]).filter(s=>s.kind!=='variable'||s.from<=pos);if(found.length===1)return found[0];if(found.length>1)return null;scope=scopes[scope].parent;}return null;};
 return {tokens,symbols,blocks:blocks.sort((a,b)=>a.from-b.from||b.to-a.to),diagnostics,ignored,pairs,scopes,scopeAt,resolve,hasBinding,callables};
}

// A record key belongs to its declared state, not to the surrounding variable scope.
function recordKeyCandidates(a, tokenIndex, pos) {
 const ts=a.tokens;
 let open=-1;
 for(let i=tokenIndex-1;i>=0;i--)if(ts[i].value==='{'&&(!a.pairs.has(i)||ts[a.pairs.get(i)].from>=pos)){open=i;break;}
 if(open<0||ts[open-1]?.value!=='='||ts[open-2]?.kind!=='name'||ts[open-3]?.kind!=='name')return null;
 if(tokenIndex!==open+1&&ts[tokenIndex-1]?.value!==',')return null;
 // Verify that the comma belongs to this record, not a nested call or value.
 const used=new Set();
 for(let i=open+1;i<tokenIndex;i++){
  if(['(','[','{'].includes(ts[i].value)){const end=a.pairs.get(i);if(end===undefined||end>=tokenIndex)return null;i=end;continue;}
  if(ts[i].kind==='name'&&ts[i+1]?.value===':')used.add(ts[i].value);
 }
 const fields=[],visited=new Set();let name=ts[open-3].value;
 while(name&&!visited.has(name)){
  visited.add(name);const states=a.symbols.filter(s=>s.kind==='state'&&s.name===name&&s.scope===0);
  if(states.length!==1)return [];
  const state=states[0];fields.push(...a.symbols.filter(s=>s.scope===state.bodyScope&&s.kind==='variable').map(s=>s.name));
  const i=ts.findIndex(t=>t.from===state.from);name=ts[i+1]?.value==='expands'?ts[i+2]?.value:null;
 }
 return [...new Set(fields)].filter(name=>!used.has(name));
}

export function liveContext(text,pos,analysis=analyzeLive(text)) {
 pos=Math.max(0,Math.min(pos,text.length));const a=analysis,empty={completion:null,parameter:null,occurrences:[],blocks:a.blocks.filter(b=>b.from<=pos&&pos<=b.to),diagnostics:a.diagnostics};
 if(a.ignored.some(t=>t.from<=pos&&pos<t.to))return empty;
 const tokenIndex=a.tokens.findIndex(t=>t.kind==='name'&&t.from<=pos&&pos<=t.to),token=a.tokens[tokenIndex];
 if(token){const symbol=a.resolve(token.value,token.from,tokenIndex);if(symbol)empty.occurrences=a.tokens.flatMap((t,i)=>t.kind==='name'&&a.resolve(t.value,t.from,i)?.id===symbol.id?[{from:t.from,to:t.to}]:[]);
  const member=a.tokens[tokenIndex-1]?.value==='.';const selfMember=member&&a.tokens[tokenIndex-2]?.value==='self';
  if(pos===token.to&&pos-token.from>=2&&(!member||selfMember)&&!a.symbols.some(s=>s.from===token.from)) {const prefix=text.slice(token.from,pos),seen=new Set(),matches=[];for(const s of a.symbols){if(s.name.startsWith(prefix)&&s.name!==prefix&&!seen.has(s.name)&&a.resolve(s.name,pos,selfMember?tokenIndex:-1)?.id===s.id){seen.add(s.name);matches.push(s.name);}}if(!member&&!matches.length)for(const name of [...builtinSignatures.keys(),...keywords,...primitiveTypes])if(name.startsWith(prefix)&&name!==prefix&&!seen.has(name)&&!a.hasBinding(name,pos)){seen.add(name);matches.push(name);}const recordFields=recordKeyCandidates(a,tokenIndex,pos);if(recordFields!==null){matches.length=0;matches.push(...recordFields.filter(name=>name.startsWith(prefix)&&name!==prefix));}if(matches.length===1)empty.completion={from:token.from,to:pos,text:matches[0]};}
 }
 for(let i=a.tokens.length-1;i>=0;i--){const t=a.tokens[i];if(t.value!=='('||t.from>=pos)continue;const end=a.pairs.get(i);if(end!==undefined&&a.tokens[end].from<pos)continue;if(a.callables.some(c=>c.open===i))continue;
  const name=a.tokens[i-1];if(name?.kind!=='name'||a.tokens[i-2]?.value==='.')continue;const s=a.resolve(name.value,name.from,i-1);const signature=s?.signature||(!s&&!a.hasBinding(name.value,name.from)?builtinSignatures.get(name.value):null);if(!signature)break;
  let active=0;for(let j=i+1;j<a.tokens.length&&a.tokens[j].from<pos;j++){if(['(','[','{'].includes(a.tokens[j].value)){const close=a.pairs.get(j);if(close===undefined||a.tokens[close].from>=pos)break;j=close;}else if(a.tokens[j].value===',')active++;}
  empty.parameter={...signature,active};break;
 }
 return empty;
}
