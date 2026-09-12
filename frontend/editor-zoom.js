export const editorZoom=settings=>Math.min(250,Math.max(50,Number(settings?.editorZoom)||100));
export const editorFontSize=settings=>(14*editorZoom(settings)/100)+'px';
export function mountZoomControls(context){
 const root=document.createElement('div');root.className='editor-zoom-controls';
 const less=document.createElement('button'),value=document.createElement('input'),more=document.createElement('button'),percent=document.createElement('button');
 less.type=more.type=percent.type='button';less.textContent='−';more.textContent='+';
 value.type='range';value.min='50';value.max='250';value.step='10';
 let running=false,desired=null;
 function refresh(){const s=context.getSettings(),en=s.language==='en',n=desired??editorZoom(s);less.title=less.ariaLabel=en?'Decrease code font size':'Code-Schrift verkleinern';more.title=more.ariaLabel=en?'Increase code font size':'Code-Schrift vergrößern';value.title=value.ariaLabel=en?'Code font size (%)':'Code-Schriftgröße (%)';percent.title=percent.ariaLabel=en?'Reset code font size to 100%':'Code-Schriftgröße auf 100 % zurücksetzen';value.value=String(n);percent.textContent=n+' %';less.disabled=n<=50;more.disabled=n>=250;}
 async function change(n){desired=Math.min(250,Math.max(50,n));refresh();if(running)return;running=true;try{while(desired!==null){const next=desired;await context.setSettings({...context.getSettings(),editorZoom:next});if(desired===next)desired=null;}}catch(e){desired=null;context.notify(String(e.message||e));}finally{running=false;refresh();}}
 less.onclick=()=>change((desired??editorZoom(context.getSettings()))-10);more.onclick=()=>change((desired??editorZoom(context.getSettings()))+10);value.oninput=()=>change(Number(value.value));percent.onclick=()=>change(100);
 root.append(less,value,more,percent);refresh();root.refresh=refresh;return root;
}
