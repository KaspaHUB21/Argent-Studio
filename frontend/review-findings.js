export const REVIEW_LIMITS=Object.freeze({findings:32,title:200,message:4000,suggestion:16000,total:64000});
export function normalizeReviewFindings(payload,text,readOnly=false){
 const normalize=value=>value.replace(/\r\n?/g,'\n');
 text=normalize(text);
 if(readOnly||!payload||typeof payload.before!=='string'||normalize(payload.before)!==text||!Array.isArray(payload.findings)||payload.findings.length>REVIEW_LIMITS.findings)return null;
 const lines=text.split('\n').length,findings=[];let total=0;
 for(const item of payload.findings){
  if(!item||!Number.isInteger(item.startLine)||!Number.isInteger(item.endLine)||item.startLine<1||item.endLine<item.startLine||item.endLine>lines)return null;
  for(const name of ['title','message'])if(typeof item[name]!=='string'||!item[name].trim()||item[name].length>REVIEW_LIMITS[name])return null;
  if(item.suggestion!=null&&(typeof item.suggestion!=='string'||item.suggestion.length>REVIEW_LIMITS.suggestion))return null;
  if(item.original!=null&&(typeof item.original!=='string'||item.original.length>REVIEW_LIMITS.total||normalize(item.original)!==text.split('\n').slice(item.startLine-1,item.endLine).join('\n')))return null;
  total+=item.original?.length||0;
  total+=item.title.length+item.message.length+(item.suggestion?.length||0);if(total>REVIEW_LIMITS.total)return null;
  findings.push({startLine:item.startLine,endLine:item.endLine,title:item.title,message:item.message,...(item.original!=null?{original:normalize(item.original)}:{}),...(item.suggestion!=null?{suggestion:item.suggestion}:{})});
 }
 return {before:normalize(payload.before),findings,onRequestProposal:typeof payload.onRequestProposal==='function'?payload.onRequestProposal:undefined,open:null};
}
