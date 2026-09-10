const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};

export function createUpdater({getSettings,prepareUpdate,isSupported=()=>true,check=async()=>{const plugin=await import('@tauri-apps/plugin-updater');return plugin.check({timeout:10000});}}){
 let checking=false,active=null;
 const t=(de,en)=>getSettings()?.language==='en'?en:de;
 function notice(text){const dialog=element('dialog','message-dialog update-dialog'),title=element('h2','',t('Programmaktualisierung','Application update')),message=element('p','',text),buttons=element('div','dialog-buttons'),close=element('button','',t('Schließen','Close'));dialog.setAttribute('aria-label',title.textContent);close.onclick=()=>dialog.close();buttons.append(close);dialog.append(title,message,buttons);dialog.addEventListener('close',()=>{dialog.remove();if(active===dialog)active=null;},{once:true});document.body.append(dialog);active=dialog;dialog.showModal();}
 async function checkForUpdates({manual=false}={}){
  if(checking||active)return;
  if(!isSupported()){if(manual)notice(t('Updates werden in der installierten Windows-Anwendung unterstützt.','Updates are supported in the installed Windows application.'));return;}
  checking=true;
  try{const update=await check();if(update)showUpdate(update);else if(manual)notice(t('Du verwendest bereits die aktuelle Version.','You are already using the latest version.'));}
  catch{if(manual)notice(t('Updates konnten nicht geprüft werden. Bitte prüfe deine Internetverbindung und versuche es später erneut.','Could not check for updates. Please check your internet connection and try again later.'));}
  finally{checking=false;}
 }
 function showUpdate(update){
  const dialog=element('dialog','message-dialog update-dialog'),titlebar=element('div','update-titlebar'),title=element('h2','',t('Neue Version verfügbar','New version available')),close=element('button','update-close','×'),version=element('p','update-version',t('Version ','Version ')+update.version),notes=element('pre','update-notes',update.body||t('Eine neue Version von Argent Studio ist verfügbar.','A new version of Argent Studio is available.')),status=element('p','update-status',t('Deine Änderungen werden vor dem Update gespeichert. Das Programm wird für die Installation geschlossen.','Your changes will be saved before updating. The application will close for installation.')),progress=element('progress','update-progress'),buttons=element('div','dialog-buttons'),later=element('button','',t('Später','Later')),install=element('button','',t('Jetzt aktualisieren','Update now'));
  let installing=false;
  dialog.setAttribute('aria-label',title.textContent);close.setAttribute('aria-label',t('Schließen','Close'));status.setAttribute('role','status');progress.setAttribute('aria-label',t('Downloadfortschritt','Download progress'));progress.hidden=true;progress.max=100;titlebar.append(title,close);buttons.append(later,install);dialog.append(titlebar,version,notes,status,progress,buttons);
  const dismiss=()=>{if(!installing)dialog.close();};close.onclick=dismiss;later.onclick=dismiss;dialog.addEventListener('cancel',event=>{if(installing)event.preventDefault();});
  dialog.addEventListener('close',()=>{dialog.remove();if(active===dialog)active=null;Promise.resolve(update.close?.()).catch(()=>{});},{once:true});
  install.onclick=async()=>{
   if(installing)return;installing=true;close.disabled=later.disabled=install.disabled=true;let release;
   try{
    status.textContent=t('Änderungen werden gespeichert …','Saving changes …');release=await prepareUpdate();
    if(release===false){status.textContent=t('Das Update wurde nicht gestartet. Bitte beende laufende Vorgänge und speichere deine Änderungen.','The update was not started. Please finish running operations and save your changes.');return;}
    progress.hidden=false;progress.removeAttribute('value');status.textContent=t('Update wird heruntergeladen …','Downloading update …');let total=0,received=0;
    await update.downloadAndInstall(event=>{
     if(event.event==='Started'){total=event.data?.contentLength||0;received=0;}
     if(event.event==='Progress'){received+=event.data?.chunkLength||0;if(total){progress.value=Math.min(100,received/total*100);status.textContent=t('Download: ','Downloading: ')+Math.round(progress.value)+' %';}}
     if(event.event==='Finished'){progress.value=100;status.textContent=t('Download abgeschlossen. Installation wird gestartet …','Download complete. Starting installation …');}
    });
    status.textContent=t('Update installiert. Bitte starte Argent Studio neu.','Update installed. Please restart Argent Studio.');install.hidden=true;later.textContent=t('Schließen','Close');
   }catch{progress.hidden=true;status.textContent=t('Das Update konnte nicht abgeschlossen werden. Deine Dateien bleiben erhalten. Bitte versuche es später erneut.','The update could not be completed. Your files are preserved. Please try again later.');}
   finally{if(typeof release==='function')release();installing=false;close.disabled=later.disabled=install.disabled=false;}
  };
  document.body.append(dialog);active=dialog;dialog.showModal();later.focus();
 }
 return {checkForUpdates};
}
