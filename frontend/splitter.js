export function bindSplitter(node,{axis,label,getSize,setSize,min,max,direction=1}){
 node.tabIndex=0;node.setAttribute('role','separator');node.setAttribute('aria-label',label);
 node.setAttribute('aria-orientation',axis==='x'?'vertical':'horizontal');node.title=label;
 const apply=size=>{const lower=min(),upper=Math.max(lower,max());const next=Math.max(lower,Math.min(upper,size));setSize(next);node.setAttribute('aria-valuenow',String(Math.round(next)));node.setAttribute('aria-valuemin',String(lower));node.setAttribute('aria-valuemax',String(Math.round(upper)));};
 let drag=null;
 function finish(){if(!drag)return;const id=drag.id;drag=null;node.classList.remove('dragging');document.body.classList.remove('resizing-columns','resizing-rows');document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',finish,true);document.removeEventListener('pointercancel',finish,true);window.removeEventListener('blur',finish);if(node.hasPointerCapture(id))node.releasePointerCapture(id);}
 function move(e){if(!drag||e.pointerId!==drag.id)return;e.preventDefault();apply(drag.size+direction*((axis==='x'?e.clientX:e.clientY)-drag.start));}
 node.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();finish();drag={id:e.pointerId,start:axis==='x'?e.clientX:e.clientY,size:getSize()};node.classList.add('dragging');document.body.classList.add(axis==='x'?'resizing-columns':'resizing-rows');node.setPointerCapture(e.pointerId);document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',finish,true);document.addEventListener('pointercancel',finish,true);window.addEventListener('blur',finish);});
 node.addEventListener('lostpointercapture',finish);node.addEventListener('dragstart',e=>e.preventDefault());
 node.addEventListener('keydown',e=>{const negative=axis==='x'?'ArrowLeft':'ArrowUp',positive=axis==='x'?'ArrowRight':'ArrowDown';if(![negative,positive,'Home','End'].includes(e.key))return;e.preventDefault();apply(e.key==='Home'?min():e.key==='End'?max():getSize()+(e.key===positive?1:-1)*direction*(e.shiftKey?40:10));});
 return {finish,refresh:()=>apply(getSize())};
}
