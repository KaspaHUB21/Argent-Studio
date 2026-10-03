import {localizeError} from './errors-i18n.js';
// Local editor history. No model requests and no project-file writes.
export function createCodeHistory(context) {
 let queue=Promise.resolve(), timer=null, pending=new Map(), dialog=null, epoch=0, lastError=null;
 const normalize=p=>String(p||'').replaceAll('\\','/');
 const language=()=>context.getSettings?.()?.language==='en';
 const t=(de,en)=>language()?en:de;
 const labels={opened:['Geöffnet','Opened'],edit:['Entwurf','Draft'],saved:['Gespeichert','Saved'],'before-ai':['Vor KI-Änderung','Before AI change'],ai:['KI-Änderung','AI change'],'before-restore':['Vor Wiederherstellung','Before restore'],restored:['Wiederhergestellt','Restored']};
 function capture(doc,reason) {
  const root=context.getProjectRoot?.();
  if(!root||!doc||doc.generated||typeof doc.text!=='string'||!doc.path?.endsWith('.ag'))return null;
  const base=normalize(root).replace(/\/$/,''), full=normalize(doc.path);
  const insensitive=/^[a-z]:\//i.test(base),key=s=>insensitive?s.toLowerCase():s;
  if(!key(full).startsWith(key(base)+'/'))return null;
  return {projectRoot:root,path:full.slice(base.length+1),text:doc.text,reason};
 }
 function enqueue(snapshot) {
  if(!snapshot)return Promise.resolve([]);
  const work=queue.then(()=>context.invoke('checkpoint_code_history',snapshot));
  queue=work.then(()=>{lastError=null;},error=>{lastError=error;});
  // Background writes always settle; explicit open/restore report retained errors.
  return work.catch(()=>null);
 }
 function flushPending(){if(timer)clearTimeout(timer);timer=null;const snapshots=[...pending.values()];pending.clear();for(const snapshot of snapshots)enqueue(snapshot);return queue;}
 function checkpoint(doc,reason='edit'){flushPending();return enqueue(capture(doc,reason));}
 function schedule(doc){const snapshot=capture(doc,'edit');if(!snapshot)return;pending.set(snapshot.projectRoot+'\0'+snapshot.path,snapshot);if(timer)clearTimeout(timer);timer=setTimeout(flushPending,1800);}
 function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
 function close(){if(dialog){dialog.close?.();dialog.remove();dialog=null;}epoch++;}
 async function open(doc=context.getDocument?.()) {
  const captured=capture(doc,'opened');
  if(!captured){context.notify?.(t('Code-History ist für Argent-Dateien im Projekt verfügbar.','Code history is available for Argent files in the project.'));return;}
  close();const activeEpoch=epoch;await flushPending();
  if(activeEpoch!==epoch)return;
  const modal=element('dialog','code-history-dialog');dialog=modal;modal.setAttribute('aria-label',t('Code-History','Code history'));
  const header=element('header','code-history-header'),title=element('h2','',t('Code-History','Code history')),name=element('div','code-history-path',captured.path),dismiss=element('button','',t('Schließen','Close'));
  dismiss.type='button';dismiss.onclick=close;header.append(title,name,dismiss);
  const notice=element('p','code-history-notice',t('Lokal auf diesem Gerät: bis zu 50 Versionen pro Datei (4 MB). Wiederherstellen ändert den Editor; Speichern erfolgt anschließend bewusst.','Local to this device: up to 50 versions per file (4 MB). Restore changes the editor; save explicitly afterward.'));
  const body=element('div','code-history-body'),list=element('div','code-history-list'),preview=element('div','code-history-preview'),status=element('p','code-history-status'),restore=element('button','code-history-restore',t('Im Editor wiederherstellen','Restore in editor'));
  restore.type='button';restore.disabled=true;body.append(list,preview);modal.append(header,notice,body,status,restore);document.body.append(modal);
  modal.addEventListener('cancel',()=>{dialog=null;epoch++;});modal.addEventListener('close',()=>{modal.remove();if(dialog===modal)dialog=null;});modal.showModal();
  const valid=()=>dialog===modal&&epoch===activeEpoch&&context.getProjectRoot()===captured.projectRoot;
  let selected=null,selection=0;
  async function choose(entry,button){
   const ticket=++selection;selected=null;restore.disabled=true;status.textContent=t('Version wird geladen …','Loading version …');
   try{
    const text=await context.invoke('read_code_history',{projectRoot:captured.projectRoot,path:captured.path,id:entry.id});
    if(!valid()||ticket!==selection)return;
    selected={entry,text};for(const item of list.children)item.setAttribute('aria-pressed',String(item===button));
    preview.replaceChildren();
    const current=context.getDocument?.();
    for(const [heading,value]of [[t('Aktueller Editor','Current editor'),current?.path===doc.path?current.text:captured.text],[t('Ausgewählte Version','Selected version'),text]]){
     const panel=element('section','code-history-code');panel.append(element('h3','',heading),element('pre','',value));preview.append(panel);
    }
    status.textContent=t('Version auswählen und bei Bedarf wiederherstellen.','Select a version and restore if needed.');restore.disabled=false;
   }catch(error){if(valid())status.textContent=localizeError(error,context.getSettings?.()?.language);}
  }
  restore.onclick=async()=>{
   if(!selected||!valid())return;
   const current=context.getDocument?.();
   if(!current||current.path!==doc.path){status.textContent=t('Öffne zuerst die zugehörige Datei.','Open the corresponding file first.');return;}
   const baseline=current.text,version=selected.text;restore.disabled=true;
   const saved=await checkpoint(current,'before-restore');
   if(!valid())return;
   if(saved===null){status.textContent=t('Aktuellen Stand konnte die History nicht sichern: ','Could not preserve current version: ')+localizeError(lastError,context.getSettings?.()?.language);restore.disabled=false;return;}
   const latest=context.getDocument?.();if(!latest||latest.path!==doc.path||latest.text!==baseline){status.textContent=t('Der Editor hat sich geändert. Version erneut auswählen.','Editor changed. Select the version again.');restore.disabled=false;return;}
   try{
    const result=await context.updateDocument(doc.path,version,baseline);
    if(result===false)throw Error(t('Der Editor hat sich geändert.','Editor changed.'));
    await checkpoint({...current,text:version},'restored');close();
   }catch(error){if(valid()){status.textContent=localizeError(error,context.getSettings?.()?.language);restore.disabled=false;}}
  };
  try{
   if(lastError)throw lastError;
   const entries=await context.invoke('list_code_history',{projectRoot:captured.projectRoot,path:captured.path});
   if(!valid())return;
   if(!entries.length){status.textContent=t('Noch keine Versionen. Beim Öffnen, Bearbeiten und Speichern entstehen lokale Checkpoints.','No versions yet. Opening, editing and saving create local checkpoints.');return;}
   for(const entry of entries){const pair=labels[entry.reason],reason=pair?pair[language()?1:0]:entry.reason;const button=element('button','code-history-entry',new Date(entry.createdAt).toLocaleString(language()?'en-GB':'de-DE')+' · '+reason);button.type='button';button.setAttribute('aria-pressed','false');button.onclick=()=>choose(entry,button);list.append(button);}
   await choose(entries[0],list.firstElementChild);
  }catch(error){if(valid())status.textContent=t('History konnte nicht geladen werden: ','Could not load history: ')+localizeError(error,context.getSettings?.()?.language);}
 }
 return {checkpoint,schedule,open,flush:flushPending,projectChanged(){flushPending();close();lastError=null;},dispose(){flushPending();close();},refresh(){const doc=context.getDocument?.();if(dialog)void open(doc);}};
}

