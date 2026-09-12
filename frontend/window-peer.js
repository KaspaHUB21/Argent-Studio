export function createWindowPeer(channelName,handler,{native=false,target,self}={}){
 const pending=new Map();let closed=false;
 const channel=native?{postMessage:null,close:()=>{}}:new BroadcastChannel(channelName);
 const ready=native?import('@tauri-apps/api/event').then(async({listen,emitTo})=>{channel.close=await listen(channelName,event=>channel.onmessage({data:event.payload}),{target:self});channel.postMessage=data=>emitTo(target,channelName,data);if(closed)channel.close();}):Promise.resolve();
 channel.onmessage=async({data})=>{
  if(data.kind==='reply'){const entry=pending.get(data.id);if(!entry)return;pending.delete(data.id);clearTimeout(entry.timer);data.error?entry.reject(Error(data.error)):entry.resolve(data.value);return;}
  if(data.kind==='notice'){handler(data.action,data.value,true);return;}
  if(data.kind!=='request')return;
  try{const value=await handler(data.action,data.value,false);if(!closed)await channel.postMessage({kind:'reply',id:data.id,value});}
  catch(error){if(!closed)await channel.postMessage({kind:'reply',id:data.id,error:String(error.message||error)});}
 };
 return {ready,async request(action,value){await ready;if(closed)throw Error('Window connection closed');const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Window did not respond'));},20000);pending.set(id,{resolve,reject,timer});Promise.resolve().then(()=>channel.postMessage({kind:'request',id,action,value})).catch(error=>{pending.delete(id);clearTimeout(timer);reject(error);});});},notify(action,value){ready.then(()=>{if(!closed)return channel.postMessage({kind:'notice',action,value});}).catch(error=>console.error('Window communication:',error));},close(){closed=true;channel.close();for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('Window connection closed'));}pending.clear();}};
}
export function validateRemoteEdit(doc,edit){
 if(!doc||doc.generated||doc.readOnly)throw Error('Document is not editable');
 if(doc.text!==edit.before)throw Error('Concurrent edit conflict');
 if(typeof edit.text!=='string')throw Error('Invalid document text');
 return edit.text;
}
