// A bounded line diff. When the matrix would be too large, keep the exact
// common prefix/suffix and display the remaining change as one honest block.
export function proposalHunks(before,after,maxCells=1_000_000){
 if(before===after)return [];
 const a=before.split('\n'),b=after.split('\n');let start=0,ae=a.length,be=b.length;
 while(start<ae&&start<be&&a[start]===b[start])start++;
 while(ae>start&&be>start&&a[ae-1]===b[be-1]){ae--;be--;}
 const result=[];const add=(af,at,bf,bt)=>result.push({fromLine:af+1,toLine:at,before:a.slice(af,at).join('\n'),after:b.slice(bf,bt).join('\n'),removedLines:at-af,addedLines:bt-bf});
 const n=ae-start,m=be-start;
 if((n+1)*(m+1)>maxCells){add(start,ae,start,be);return result;}
 const table=new Uint32Array((n+1)*(m+1)),w=m+1;
 for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)table[i*w+j]=a[start+i]===b[start+j]?table[(i+1)*w+j+1]+1:Math.max(table[(i+1)*w+j],table[i*w+j+1]);
 let i=0,j=0,af=null,bf=null;
 const flush=()=>{if(af!==null){add(start+af,start+i,start+bf,start+j);af=bf=null;}};
 while(i<n||j<m){if(i<n&&j<m&&a[start+i]===b[start+j]){flush();i++;j++;continue;}if(af===null){af=i;bf=j;}if(j<m&&(i===n||table[i*w+j+1]>table[(i+1)*w+j]))j++;else i++;}
 flush();return result;
}
export function proposalMatches(proposal,text,readOnly=false){return Boolean(proposal&&!readOnly&&proposal.before===text);}
