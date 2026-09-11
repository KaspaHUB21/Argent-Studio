// Conservative semantic checks for complete, locally understood AG expressions.
// Ordinary body syntax is delegated to SilverScript by the pinned Argent parser.
import {builtins} from './live-builtins.js';
const primitive = new Set(['int','bool','string']);
const signature = value => {
 const raw=typeof value==='string'?value:value?.text;
 const match=raw?.match(/^[\w.]+\(([^()]*)\)(?:\s*->\s*(.+))?$/);
 if(!match||match[1].includes('...'))return null;
 const params=match[1].trim()?match[1].split(',').map(p=>{const v=p.trim();const colon=v.match(/^\w+\s*:\s*(.+)$/);return colon?colon[1]:v.match(/^(.+)\s+\w+$/)?.[1]||null;}):[];
 return {params,returnType:match[2]?.trim()||null};
};
const builtinMap=new Map(builtins.map(b=>[b.name,signature(b.signature)]));
export function analyzeCalls(text,a,project={}) {
 if(a.diagnostics?.some(d=>["unclosed","unexpected-close"].includes(d.code)))return [];
 const t=a.tokens,p=a.pairs,out=[],index=new Map(t.map((v,i)=>[v.from,i]));
 const emit=(code,severity,from,to,messageEn,messageDe,extra={})=>out.push({code,severity,from,to,messageEn,messageDe,...extra});
 const local=new Map();
 for(const c of a.callables){const sig=signature(c.symbol.signature);if(!sig)continue;const body=t.findIndex((v,i)=>i>c.end&&v.value==='{'&&a.scopes[c.symbol.bodyScope]?.from===v.to);if(body<0||!p.has(body))continue;const tail=text.slice(t[c.end].to,t[body].from).trim();sig.returnType=tail.match(/^->\s*(\w+(?:\s*\[[^\]]*\])?)$/)?.[1]?.replace(/\s/g,'')||null;local.set(c.symbol.id,{...sig,body,end:p.get(body),symbol:c.symbol});}
 const get=(i)=>{if(t[i-1]?.value==='.'||t[i-1]?.value===':')return null;const s=a.resolve(t[i].value,t[i].from,i);if(s)return local.get(s.id)||null;if(a.hasBinding(t[i].value,t[i].from))return null;const imported=(project.symbols||[]).filter(s=>s.name===t[i].value&&s.kind==='fn');if(imported.length===1){const sig=signature(imported[0].signature);return sig?{...sig,returnType:imported[0].returnType||sig.returnType}:null;}if(imported.length>1)return null;return builtinMap.get(t[i].value)||null;};
 const typeOfSymbol=s=>{if(!s)return null;let i=index.get(s.from);if(i===undefined)return null;let prev=i-1;if(t[prev]?.value===']')return null;const type=t[prev]?.value;return primitive.has(type)?type:null;};
 const parts=(start,end)=>{const result=[];let begin=start,boundary=t[start-1].to;const literalBefore=to=>a.ignored.some(v=>v.from>=boundary&&v.to<=to&&!v.value.startsWith('/'));for(let j=start;j<end;j++){if(['(','[','{'].includes(t[j].value)){if(!p.has(j)||p.get(j)>=end)return null;j=p.get(j);}else if(t[j].value===','){if(j===begin&&!literalBefore(t[j].from))return null;result.push([begin,j]);begin=j+1;boundary=t[j].to;}}if(begin<end||literalBefore(t[end].from))result.push([begin,end]);else if(begin!==start)return null;return result;};
 const infer=(start,end,depth=0)=>{if(depth>8||start>=end)return null;while(t[start]?.value==='('&&p.get(start)===end-1){start++;end--;}if(start>=end)return null;const raw=text.slice(t[start].from,t[end-1].to).trim();if(/^(true|false)$/.test(raw))return 'bool';if(/^-?\s*\d(?:[\d_]*\d)?$/.test(raw))return 'int';if(end===start+1&&t[start].kind==='name')return typeOfSymbol(a.resolve(t[start].value,t[start].from,start));if(t[start].kind==='name'&&t[start+1]?.value==='('&&p.get(start+1)===end-1)return get(start)?.returnType||null;return null;};
 const mismatch=(expected,start,end,context)=>{const got=infer(start,end);if(primitive.has(expected)&&primitive.has(got)&&expected!==got)emit('type-mismatch','warning',t[start].from,t[end-1].to,`${context}: expected ${expected}, received ${got}.`,`${context}: ${expected} erwartet, ${got} erhalten.`);};
 for(let i=0;i<t.length-1;i++){
  if(t[i].kind==='name'&&t[i+1]?.value==='('&&p.has(i+1)&&!a.callables.some(c=>c.open===i+1)){
   const sig=get(i),end=p.get(i+1);if(!sig)continue;const args=parts(i+2,end);if(!args)continue;
   if(args.length!==sig.params.length)emit('argument-count','warning',t[i].from,t[end].to,`${t[i].value} expects ${sig.params.length} argument(s); received ${args.length}.`,`${t[i].value} erwartet ${sig.params.length} Argument(e); ${args.length} erhalten.`);
   else args.forEach(([start,end],n)=>mismatch(sig.params[n],start,end,`${t[i].value}, ${n+1}`));
  }
  if(t[i].value==='='&&t[i-1]?.kind==='name'&&t[i+1]?.value!=='='&&t[i-2]?.value!=='.'){
   const expected=typeOfSymbol(a.resolve(t[i-1].value,t[i-1].from,i-1));let end=i+1;while(end<t.length&&![';', '}'].includes(t[end].value)){if(['(','[','{'].includes(t[end].value)){if(!p.has(end))break;end=p.get(end);}end++;}if(t[end]?.value===';')mismatch(expected,i+1,end,t[i-1].value);
  }
 }
 // Parse only statement boundaries; unknown forms suppress missing-return claims.
 for(const fn of local.values()){
  if(fn.symbol.kind!=='fn')continue;
  const sequence=(start,end)=>{let returned=false,known=true,i=start;while(i<end){const stmt=statement(i,end);if(!stmt||stmt.next<=i)return {returned:false,known:false};if(returned&&t[i].value!==';')emit('unreachable-code','hint',t[i].from,t[stmt.next-1].to,'This statement cannot be reached after a return.','Diese Anweisung ist nach einer Rückgabe nicht erreichbar.',{fade:true});returned ||= stmt.returned;known &&= stmt.known;i=stmt.next;}return {returned,known};};
  const statement=(i,end)=>{
   if(t[i].value==='{'){const close=p.get(i);if(close===undefined||close>end)return null;return {...sequence(i+1,close),next:close+1};}
   if(t[i].value==='if'){const open=i+1,close=p.get(open);if(t[open]?.value!=='('||close===undefined)return null;const yes=statement(close+1,end);if(!yes)return null;if(t[yes.next]?.value==='else'){const no=statement(yes.next+1,end);if(!no)return null;return {next:no.next,returned:yes.returned&&no.returned,known:yes.known&&no.known};}return {next:yes.next,returned:false,known:yes.known};}
   if(['for','while'].includes(t[i].value)){const close=p.get(i+1);if(close===undefined)return null;const body=statement(close+1,end);return body?{next:body.next,returned:false,known:false}:null;}
   let j=i;for(;j<end;j++){if(['(','[','{'].includes(t[j].value)){const close=p.get(j);if(close===undefined||close>=end)return null;j=close;}else if(t[j].value===';')break;}if(j===end)return null;
   if(t[i].value==='return'){if(fn.returnType&&i+1===j&&!a.ignored.some(v=>v.from>=t[i].to&&v.to<=t[j].from&&!v.value.startsWith('/')))emit('missing-return-value','warning',t[i].from,t[j].to,`Return a value of type ${fn.returnType}.`,`Gib einen Wert vom Typ ${fn.returnType} zur�ck.`);if(fn.returnType&&i+1<j)mismatch(fn.returnType,i+1,j,'return');return {next:j+1,returned:true,known:true};}
   return {next:j+1,returned:false,known:!['fn','entry','delegate','become','match','switch','case','break','continue','throw','try','do'].includes(t[i].value)};
  };
  const flow=sequence(fn.body+1,fn.end);if(fn.returnType&&flow.known&&!flow.returned)emit('missing-return','warning',fn.symbol.from,fn.symbol.to,`Function '${fn.symbol.name}' may finish without returning ${fn.returnType}.`,`Funktion „${fn.symbol.name}“ kann ohne Rückgabe von ${fn.returnType} enden.`);
 }
 return out;
}
