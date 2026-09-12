import {localizeError} from './errors-i18n.js';
import {createWindowPeer} from './window-peer.js';
import {mountStructure} from './structure.js';
import {createEditor} from './editor.js';
import {mountZoomControls} from './editor-zoom.js';
import './style.css';import './structure.css';import './detached.css';
const query=new URLSearchParams(location.search),browser=query.get('browser')==='1';
let data=null,latest=null,structure=null,editing=0,queue=Promise.resolve(),locked=false,conflicts=new Map(),closing=false;
const app=document.querySelector('#app');app.classList.add('detached-app');
const toolbar=document.createElement('header');toolbar.className='detached-toolbar';
const grip=document.createElement('button');grip.className='structure-window-grip';grip.textContent='✥';
const title=document.createElement('span'),version=document.createElement('small'),dock=document.createElement('button'),save=document.createElement('button');
version.className='app-version';toolbar.append(grip,title,save,dock);
const warning=document.createElement('div');warning.className='detached-warning';warning.hidden=true;
const host=document.createElement('main');host.className='detached-structure-host';
const status=document.createElement('footer');status.className='statusbar';app.replaceChildren(toolbar,warning,host,status);
const t=(de,en)=>data?.settings?.language==='en'?en:de;
const peer=createWindowPeer(query.get('channel'),async(action,value)=>{
 if(action==='snapshot'){latest=value;if(!editing&&!conflicts.size&&!locked)apply(value);return;}
 if(action==='inspect')return {ready:!!structure,version:data?.version,path:data?.path,text:data?.documents.find(d=>d.path===data.path)?.text,fontSize:host.querySelector('.cm-scroller')?getComputedStyle(host.querySelector('.cm-scroller')).fontSize:null,conflict:conflicts.size>0};
 if(action==='flush'){await queue;return {ok:!conflicts.size};}
 if(action==='prepareDock'){locked=true;await queue;if(conflicts.size){locked=false;showConflict();return {ok:false};}return {ok:true,viewState:structure?.getViewState()};}
},{native:!browser,target:'main',self:'structure'});
function apply(value){
 data=value;
 document.documentElement.dataset.theme=data.settings.darkMode?'dark':'light';document.body.classList.toggle('dark',!!data.settings.darkMode);
 title.textContent=t('Struktur','Structure')+' · '+(data.path?.split(/[\\/]/).pop()||'');version.textContent=data.version?'v'+data.version:'';if(nativeWindow){const next='Argent Studio · '+title.textContent;if(lastWindowTitle!==next){lastWindowTitle=next;nativeWindow.setTitle(next).catch(e=>notify(e.message));}}
 grip.title=grip.ariaLabel=t('Fenster verschieben · zum Andocken über die Strukturfläche ziehen','Move window · drag over the structure area to dock');
 dock.textContent=t('Andocken','Dock');save.textContent=t('Alle speichern','Save all');
 toolbar.querySelector('.editor-zoom-controls')?.refresh();structure?.refreshSettings();
}
function notify(text){status.textContent=localizeError(text,data?.settings?.language||'de');}
async function action(name,value){await queue;if(conflicts.size){showConflict();return;}try{const result=await peer.request(name,value);if(result?.documents){latest=result;apply(result);}return result;}catch(e){notify(e.message);}}
function commit(changes){
 if(locked||conflicts.size||data.busy)return;
 const atomic=!!changes.atomic;const edits=changes.map(c=>({path:c.path,before:c.before,text:c.text}));
 for(const edit of edits){const existing=data.documents.find(d=>d.path===edit.path);if(existing)data.documents=data.documents.map(d=>d.path===edit.path?{...d,text:edit.text}:d);else data.documents.push({path:edit.path,text:edit.text});}
 editing++;
 queue=queue.then(async()=>{if(conflicts.size){for(const edit of edits)conflicts.set(edit.path,data.documents.find(d=>d.path===edit.path)?.text||edit.text);showConflict();return;}try{latest=await peer.request('edit',{changes:edits,atomic});}catch(e){for(const doc of data.documents){if(edits.some(c=>c.path===doc.path))conflicts.set(doc.path,doc.text);}notify(e.message);showConflict();}}).finally(()=>{editing--;if(!editing&&!conflicts.size&&latest)apply(latest);});
}
function showConflict(){
 warning.hidden=false;warning.replaceChildren();const explanation=document.createElement('p');explanation.textContent=t('Diese Datei wurde gleichzeitig im Hauptfenster geändert. Deine Fassung bleibt hier erhalten. Bitte beide Fassungen prüfen.','This file was changed in the main window at the same time. Your draft is retained here. Please review both versions.');warning.append(explanation);
 for(const [path,text]of conflicts){const label=document.createElement('label');label.textContent=path;const area=document.createElement('textarea');area.value=text;area.readOnly=true;area.rows=5;label.append(area);warning.append(label);}
 const keep=document.createElement('button'),discard=document.createElement('button');keep.textContent=t('Hauptfenster mit meiner Fassung überschreiben','Overwrite main window with my draft');discard.textContent=t('Meine Fassung verwerfen und Hauptfenster übernehmen','Discard my draft and use main window');
 keep.onclick=async()=>{try{const fresh=await peer.request('snapshot');const changes=[...conflicts].map(([path,text])=>({path,text,before:fresh.documents.find(d=>d.path===path)?.text}));latest=await peer.request('edit',{changes});conflicts.clear();warning.hidden=true;apply(latest);await structure.refresh();}catch(e){notify(e.message);}};
 discard.onclick=async()=>{latest=await peer.request('snapshot');conflicts.clear();warning.hidden=true;apply(latest);await structure.refresh();};warning.append(keep,discard);
}
const context={remoteHistory:true,
 getSettings:()=>data.settings,setSettings:s=>action('settings',{editorZoom:s.editorZoom}),notify,
 getDocument:()=>data.documents.find(d=>d.path===data.path),getDocuments:()=>data.documents,getBuild:()=>data.build,
 getTestBadge:n=>data.badges?.[n.id],isBusy:()=>locked||!!data.busy||conflicts.size>0,isReadOnly:path=>!!data.documents.find(d=>d.path===path)?.readOnly,
 invoke:async(command,args)=>{await queue;return peer.request('invoke',{command,args});},
 updateDocument(path,text){const doc=data.documents.find(d=>d.path===path)||structure.getModel()?.sources?.find(d=>d.path===path);commit([{path,before:doc?.text,text}]);},commitChanges:commit,
 openFile:(path,position)=>action('openFile',{path,position}),build:()=>action('build'),undo:path=>action('undo',{path}),redo:path=>action('redo',{path}),
 createEditor:(parent,options)=>createEditor(parent,{...options,zoomContext:context,semanticChecks:false,getSettings:()=>data.settings}),
};
async function dockWindow(){if(closing)return;closing=true;try{await queue;if(conflicts.size){showConflict();return;}await peer.request('dock');}catch(e){notify(e.message);}finally{closing=false;}}
dock.onclick=dockWindow;save.onclick=()=>action('save');
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();action('save');}});
let nativeWindow=null,lastWindowTitle='';
async function startDetached(){try{
 latest=await peer.request('snapshot');apply(latest);
 structure=mountStructure(host,{...context,viewState:data.viewState});window.__ARGENT_DETACHED__={context,getData:()=>data,structure,flush:()=>queue};
 if(!browser){const api=await import('@tauri-apps/api/window');nativeWindow=api.getCurrentWindow();await nativeWindow.onCloseRequested(e=>{e.preventDefault();dockWindow();});
 let armed=false,origin=null,settled;
 async function dockAtPointer(){if(!armed)return;armed=false;try{const point=await api.cursorPosition(),rect=await peer.request('dockTarget');const inside=rect&&point.x>=rect.x&&point.x<=rect.x+rect.width&&point.y>=rect.y&&point.y<=rect.y+rect.height;peer.notify('dockHover',false);if(inside)await dockWindow();}catch(error){notify(error.message);}}
 await nativeWindow.onMoved(async({payload})=>{if(!armed||!origin||Math.hypot(payload.x-origin.x,payload.y-origin.y)<15)return;clearTimeout(settled);settled=setTimeout(dockAtPointer,450);});
 grip.onpointerdown=async e=>{if(e.button!==0)return;e.preventDefault();try{origin=await nativeWindow.outerPosition();armed=true;await nativeWindow.startDragging();}catch(error){armed=false;notify(error.message);}};

 }else grip.title=t('Fenster über die Titelleiste verschieben','Move the window using its title bar');
 apply(data);peer.notify('ready');
}catch(error){notify(error.message);host.textContent=t('Die Verbindung zum Hauptfenster konnte nicht hergestellt werden.','Could not connect to the main window.');}
}
startDetached();
window.addEventListener('beforeunload',()=>peer.close());
