import {StreamLanguage} from '@codemirror/language';

const keywords=new Set('app actor state entry fn let const if else require become spawn emits owns import from as return delegate abstract extends enum struct match true false self'.split(' '));
const types=new Set('int bool byte bytes pubkey sig string void hash'.split(' '));
const closing={'(':')','[':']','{':'}'};

export const argent=StreamLanguage.define({
 startState:()=>({comment:false,delimiters:[]}),
 copyState:state=>({...state,delimiters:state.delimiters.map(item=>({...item}))}),
 token(stream,state){
  if(state.comment){
   if(stream.skipTo('*/')){stream.match('*/');state.comment=false;}else stream.skipToEnd();
   return 'comment';
  }
  if(stream.eatSpace())return null;
  if(stream.match('//')){stream.skipToEnd();return 'comment';}
  if(stream.match('/*')){state.comment=true;return 'comment';}
  // Consume unfinished strings too: braces inside a string being typed are not blocks.
  if(stream.eat('"')){
   let escaped=false,ch;
   while((ch=stream.next())!=null){if(ch==='"'&&!escaped)break;escaped=ch==='\\'&&!escaped;}
   return 'string';
  }
  if(stream.match(/(?:0x[\da-fA-F]+|\d+)/))return 'number';
  if(stream.match(/[a-zA-Z_]\w*/)){
   const word=stream.current();return keywords.has(word)?'keyword':types.has(word)?'typeName':null;
  }
  const ch=stream.next();
  if(closing[ch])state.delimiters.push({close:closing[ch],indent:stream.indentation()});
  else if(/[}\])]/.test(ch)){
   // Recover at a matching outer delimiter while the document is incomplete.
   const index=state.delimiters.findLastIndex(item=>item.close===ch);
   if(index>=0)state.delimiters.length=index;
  }
  return null;
 },
 indent(state,textAfter,context){
  if(state.comment)return null;
  const next=textAfter.trimStart()[0];
  if(next&&/[}\])]/.test(next)){
   const match=state.delimiters.findLast(item=>item.close===next);
   if(match)return match.indent;
  }
  const parent=state.delimiters.at(-1);
  return parent?parent.indent+context.unit:0;
 },
 languageData:{
  commentTokens:{line:'//',block:{open:'/*',close:'*/'}},
  closeBrackets:{brackets:['(','[','{','"']},
  indentOnInput:/^\s*[}\])]/,
 },
});
