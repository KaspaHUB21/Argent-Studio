import {localizeError} from './errors-i18n.js';
import {createWindowPeer,validateRemoteEdit} from './window-peer.js';
export function createStructureWindow({context,getInfo,onChange,onDock,getDockRect}){
 let active=null,tick=null,last='',docking=false;
 function abandon(session){if(active!==session||docking)return;active=null;clearInterval(tick);session.peer.close();onDock(session.owner,session.viewState);onChange();}
 const snapshot=()=>({path:active?.path,root:context.getProjectRoot(),documents:context.getDocuments().map(d=>({path:d.path,text:d.text,generated:d.generated,readOnly:context.isReadOnly(d.path)})),settings:context.getSettings(),build:context.getBuild(),version:getInfo()?.version,busy:!!context.isBusy(),viewState:active?.viewState,badges:Object.fromEntries((active?.owner.structure?.getModel()?.nodes||[]).map(n=>[n.id,context.getTestBadge?.(n)]))});
 function publish(){if(!active)return;const value=snapshot(),next=JSON.stringify(value);if(next!==last){last=next;active.peer.notify('snapshot',value);}}
 async function dock(){
  if(!active||docking)return true;docking=true;
  try{const session=active;const result=await session.peer.request('prepareDock');if(!result.ok){context.notify(localizeError('Resolve the conflict in the structure window first',context.getSettings().language));return false;}session.viewState=result.viewState;await session.window.destroy();active=null;clearInterval(tick);session.peer.close();await onDock(session.owner,result.viewState);onChange();return true;}
  catch(e){context.notify(localizeError(e,context.getSettings().language));return false;}finally{docking=false;}
 }
 async function open(owner,drag=false){
  if(active){await active.window?.focus();return;}
  const session={path:owner.path,owner,viewState:owner.structure?.getViewState(),window:null,peer:null};active=session;
  let readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});
  const name='argent-structure-'+crypto.randomUUID();
  session.peer=createWindowPeer(name,async(action,args)=>{
   if(active!==session)throw Error('Structure session ended');
   if(action==='ready'){readyResolve();return;}
   if(action==='snapshot')return snapshot();
   if(action==='edit'){
    if(context.isBusy())throw Error('Project is busy');
    for(const edit of args.changes){
     const doc=context.getDocuments().find(d=>d.path===edit.path)||session.owner.structure?.getModel()?.sources?.find(d=>d.path===edit.path);
     if(context.isReadOnly(edit.path))throw Error('Document is not editable');validateRemoteEdit(doc,edit);
    }
    if(session.owner.structure)session.owner.structure.applyChanges(args.changes,!!args.atomic);else for(const edit of args.changes)context.updateDocument(edit.path,edit.text);publish();return snapshot();
   }
   if(action==='invoke'){if(args.command!=='language_request')throw Error('Unsupported structure request');return context.invoke(args.command,args.args);}
   if(action==='save'){await context.save();publish();return snapshot();}
   if(action==='build'){await context.build();publish();return snapshot();}
   if(action==='undo'||action==='redo'){await context[action](args.path);publish();return snapshot();}
   if(action==='settings'){await context.setSettings({...context.getSettings(),editorZoom:args.editorZoom});publish();return snapshot();}
   if(action==='openFile'){await context.openFile(args.path,args.position);return true;}
   if(action==='dock'){setTimeout(()=>dock(),0);return true;}
   if(action==='notify'){context.notify(args);return;}
   if(action==='dockTarget')return getDockRect();
   if(action==='dockHover'){session.owner.detachedPlaceholder?.classList.toggle('drag-target',!!args);return;}
   throw Error('Unsupported structure action');
  },{native:!window.__ARGENT_TEST__,target:'structure',self:'main'});
  const browser=!!window.__ARGENT_TEST__,url='index.html?window=structure&channel='+encodeURIComponent(name)+(browser?'&browser=1':'');
  try{
   await session.peer.ready;
   if(browser){const child=window.open(url,name,'popup,width=1000,height=800');if(!child)throw Error('Popup blocked');session.window={focus:()=>child.focus(),destroy:()=>child.close(),isClosed:()=>child.closed};}
   else{const {WebviewWindow}=await import('@tauri-apps/api/webviewWindow');const child=new WebviewWindow('structure',{url,title:'Argent Studio · Structure',width:1100,height:800,minWidth:620,minHeight:420});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Window creation timed out')),15000);child.once('tauri://created',()=>{clearTimeout(timer);resolve();});child.once('tauri://error',e=>{clearTimeout(timer);reject(Error(String(e.payload)));});});session.window={focus:()=>child.setFocus(),destroy:()=>child.destroy(),drag:()=>child.startDragging()};child.once('tauri://destroyed',()=>abandon(session));}
   await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Structure window did not initialize')),15000))]);tick=setInterval(()=>{if(session.window.isClosed?.())abandon(session);else publish();},250);onChange();publish();if(typeof drag==='function'?drag():drag)await session.window.drag?.();else await session.window.focus();
  }catch(e){active=null;await session.window?.destroy();session.peer.close();onChange();throw e;}
 }
 return {open,dock,publish,inspect:()=>active?.peer.request('inspect'),isDetached:doc=>active?.owner===doc,isOpen:()=>!!active,async flush(){if(!active)return true;try{const ok=(await active.peer.request('flush')).ok;if(!ok)context.notify(localizeError('Resolve the conflict in the structure window first',context.getSettings().language));return ok;}catch(e){context.notify(localizeError(e,context.getSettings().language));return false;}},focus:()=>active?.window?.focus()};
}
