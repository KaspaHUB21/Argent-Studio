import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proposalHunks,proposalMatches} from '../frontend/inline-proposals.js';
test('separate changes retain exact before/after blocks and original line positions',()=>{
 assert.deepEqual(proposalHunks('a\nold\nkeep\nremove\nz','a\nnew\nkeep\nz'),[
 {fromLine:2,toLine:2,before:'old',after:'new',removedLines:1,addedLines:1},
 {fromLine:4,toLine:4,before:'remove',after:'',removedLines:1,addedLines:0}]);
});
test('insertions at start and end and empty documents are represented',()=>{
 assert.deepEqual(proposalHunks('a','first\na\nlast').map(h=>[h.fromLine,h.toLine,h.before,h.after]),[[1,0,'','first'],[2,1,'','last']]);
 assert.equal(proposalHunks('','new')[0].after,'new');
 assert.equal(proposalHunks('old','')[0].before,'old');
 assert.deepEqual(proposalHunks('same','same'),[]);
});
test('matrix fallback stays exact and bounded',()=>{
 const hunks=proposalHunks('prefix\na\nb\nsuffix','prefix\nx\ny\nsuffix',1);
 assert.deepEqual(hunks.map(h=>[h.before,h.after]),[['a\nb','x\ny']]);
});
test('stale and read only sources cannot expose applicable proposals',()=>{
 assert.equal(proposalMatches({before:'old'},'old'),true);
 assert.equal(proposalMatches({before:'old'},'edited'),false);
 assert.equal(proposalMatches({before:'old'},'old',true),false);
 assert.equal(proposalMatches(null,'old'),false);
});
test('line diff reconstructs random small edits including repeated lines',()=>{
 let seed=17;const random=()=>{seed=(seed*16807)%2147483647;return seed;};
 for(let sample=0;sample<200;sample++){
  const old=Array.from({length:1+random()%12},()=>String(random()%4)).join('\n');
  const next=Array.from({length:1+random()%12},()=>String(random()%4)).join('\n');
  const lines=old.split('\n');for(const h of proposalHunks(old,next).reverse())lines.splice(h.fromLine-1,h.removedLines,...(h.addedLines?h.after.split('\n'):[]));
  assert.equal(lines.join('\n'),next);
 }
});
