import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createRequire} from 'node:module';
const {structure:realStructure}=createRequire(import.meta.url)('../resources/assets/language/structure-service.js');
let server,url;
test.beforeAll(async()=>{server=await createServer({server:{host:'127.0.0.1',port:1474,strictPort:false,hmr:false,watch:null},logLevel:'error'});await server.listen();url=server.resolvedUrls.local[0];});
test.afterAll(()=>server?.close());
test.use({browserName:process.env.ARGENT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.ARGENT_BROWSER==='webkit'?undefined:'msedge',viewport:{width:1450,height:930}});
async function mount(page,language='en'){
 await page.addInitScript(language=>{
  if(new URLSearchParams(location.search).has('window'))return;
  const root='C:/fixture/project',path=root+'/sample.ag',files={[path]:'app Sample {\n    actor Counter;\n}\n'};
  window.__FILES__=files;window.__ARGENT_TEST__={invoke:async(command,a={})=>{
   if(command==='app_info')return {version:'0.45.9',platform:'windows',resources:'C:/fixture/resources',projectsDir:root,defaultProject:{root,entry:path,app:'Sample'},compiler:'fixture'};
   if(command==='load_settings')return {language,editorZoom:100};
   if(command==='list_directory')return [{name:'sample.ag',path,isDirectory:false}];
   if(command==='read_file'){if(a.path in files)return files[a.path];throw Error('File not found');}
   if(command==='write_file'){files[a.path]=a.text;return;}
   if(command==='save_settings'){window.__SAVED_SETTINGS__=a.settings;return;}
   if(command==='read_ai_file')throw Error('File not found');
   if(command==='language_request'){
    const r=a.request;if(r.mode!=='structure')return {items:[]};if(window.__REAL_STRUCTURE__)return window.__REAL_STRUCTURE__(r);
    const n={id:'sample',kind:'app',name:'Sample',detail:'app Sample',path:r.path,text:r.text,start:0,end:r.text.length,editable:true};
    return {nodes:[n],edges:[],flow:{nodes:[{...n,role:'scope'}],edges:[]},sources:r.documents};
   }
   throw Error('Unexpected fixture command: '+command);
  }};
 },language);
 await page.goto(url);await expect(page.locator('#app-version')).toHaveText('v0.45.9');
}
async function detach(page){const opened=page.waitForEvent('popup');await page.locator('#detach-structure').click();const popup=await opened;await popup.waitForFunction(()=>window.__ARGENT_DETACHED__);await expect(popup.locator('.structure-card')).toHaveCount(1);return popup;}
for(const language of ['en','de'])test('version, shared font zoom and detached editing/docking '+language,async({page})=>{
 await mount(page,language);
 await expect(page.locator('.brand-identity #app-version')).toHaveCount(0);
 await page.locator('#menu-help > summary').click();await expect(page.locator('#menu-help #app-version')).toBeVisible();
 await expect(page.locator('#check-updates + #app-version')).toHaveCount(1);await page.locator('#menu-help > summary').click();
 await expect(page.locator('.code-host .cm-panels-bottom')).toHaveCSS('position','absolute');await page.locator('.code-host .editor-zoom-controls input').fill('140');
 await expect.poll(()=>page.locator('.code-host .cm-scroller').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeCloseTo(19.6,3);
 expect(await page.evaluate(()=>__SAVED_SETTINGS__.editorZoom)).toBe(140);
 const popup=await detach(page);
 await page.screenshot({path:'qa/structure-window-main-'+language+'.png'});await popup.screenshot({path:'qa/structure-window-detached-'+language+'.png'});
 await expect.poll(()=>popup.locator('.cm-scroller').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeCloseTo(19.6,3);
 await popup.locator('.editor-zoom-controls input').fill('250');
 await popup.locator('.editor-zoom-controls button').last().click();
 await expect.poll(()=>page.locator('.code-host .editor-zoom-controls input').inputValue()).toBe('100');
 await popup.locator('.editor-zoom-controls input').fill('120');
 await expect.poll(()=>page.locator('.code-host .editor-zoom-controls input').inputValue()).toBe('120');
 const text='app Sample {\n    actor Changed;\n}\n';
 await popup.locator('.cm-content').fill(text);
 await expect.poll(()=>page.evaluate(()=>__ARGENT_APP__.state.current.text)).toBe(text);
 await popup.getByRole('button',{name:language==='en'?'Save all':'Alle speichern',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>Object.values(__FILES__)[0])).toBe(text);
 const mainText=text+'// main window edit\n';await page.evaluate(text=>__ARGENT_APP__.context.updateDocument(__ARGENT_APP__.state.current.path,text),mainText);
 await popup.getByRole('button',{name:language==='en'?'Dock':'Andocken',exact:true}).focus();
 await expect.poll(()=>popup.evaluate(()=>__ARGENT_DETACHED__.getData().documents[0].text)).toBe(mainText);
 await popup.getByRole('button',{name:language==='en'?'Dock':'Andocken',exact:true}).click();
 await expect.poll(()=>popup.isClosed()).toBe(true);
 await expect(page.locator('.structure-view')).toBeVisible();
 expect(await page.evaluate(()=>__ARGENT_APP__.state.current.text)).toBe(mainText);
 await expect.poll(()=>page.locator('.structure-fragment-host .cm-scroller').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeCloseTo(16.8,3);
});
test('conflicting detached draft survives and blocks docking until resolved',async({page})=>{
 await mount(page);const popup=await detach(page);
 const before=await page.evaluate(()=>__ARGENT_APP__.state.current.text);
 await popup.evaluate(()=>{const a=__ARGENT_DETACHED__,path=a.getData().path;a.context.commitChanges([{path,before:'stale baseline',text:'my retained draft'}]);});
 await expect(popup.locator('.detached-warning')).toBeVisible();
 await expect(popup.locator('.detached-warning textarea')).toHaveValue('my retained draft');
 expect(await page.evaluate(()=>__ARGENT_APP__.state.current.text)).toBe(before);
 await popup.getByRole('button',{name:'Dock',exact:true}).click();expect(popup.isClosed()).toBe(false);
 await popup.getByRole('button',{name:'Discard my draft and use main window',exact:true}).click();
 await expect(popup.locator('.detached-warning')).toBeHidden();
 await popup.getByRole('button',{name:'Dock',exact:true}).click();await expect.poll(()=>popup.isClosed()).toBe(true);
 expect(await page.evaluate(()=>__ARGENT_APP__.state.current.text)).toBe(before);
});

test('settings font size, diagram position and repeated docking are retained',async({page})=>{
 await mount(page);await page.locator('#settings').click();
 await page.locator('#settings-editor-zoom').fill('160');await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.locator('.code-host .editor-zoom-controls input')).toHaveValue('160');
 await page.locator('#view-structure').click();await expect(page.locator('.structure-card')).toHaveCount(1);
 const view={selected:'sample',collapsed:['sample'],focusId:'*',scale:1.4,pan:{x:31,y:17},sidebarWidth:180,graphFraction:.6,search:''};
 await page.evaluate(view=>__ARGENT_APP__.state.current.structure.restoreViewState(view),view);
 for(let n=0;n<2;n++){
  const popup=await detach(page);
  await expect.poll(()=>popup.evaluate(()=>__ARGENT_DETACHED__.structure.getViewState().pan)).toEqual(view.pan);
  await expect.poll(()=>popup.evaluate(()=>__ARGENT_DETACHED__.structure.getViewState().focusId)).toEqual('*');
  await page.locator('.structure-detached-placeholder button').last().click();await expect.poll(()=>popup.isClosed()).toBe(true);
  const actual=await page.evaluate(()=>__ARGENT_APP__.state.current.structure.getViewState());expect(actual.pan).toEqual(view.pan);expect(actual.collapsed).toEqual(view.collapsed);
 }
});

test('main save waits for detached edits and explicit conflict resolution keeps the chosen draft',async({page})=>{
 await mount(page);const popup=await detach(page);const text='app Updated {}\n';
 await popup.locator('.cm-content').fill(text);
 await page.locator('#save').click();await expect.poll(()=>page.evaluate(()=>Object.values(__FILES__)[0])).toBe(text);
 await popup.evaluate(()=>{const a=__ARGENT_DETACHED__;a.context.commitChanges([{path:a.getData().path,before:'stale',text:'app Reviewed {}\n'}]);});
 await expect(popup.locator('.detached-warning')).toBeVisible();
 await popup.getByRole('button',{name:'Overwrite main window with my draft',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>__ARGENT_APP__.state.current.text)).toBe('app Reviewed {}\n');
 await popup.getByRole('button',{name:'Dock',exact:true}).click();await expect.poll(()=>popup.isClosed()).toBe(true);
 await page.evaluate(()=>__ARGENT_APP__.context.undo(__ARGENT_APP__.state.current.path));
 await expect.poll(()=>page.evaluate(()=>__ARGENT_APP__.state.current.text)).toBe(text);
});

test('real structure follows unsaved text changes embedded and detached',async({page})=>{
 await page.exposeFunction('__REAL_STRUCTURE__',realStructure);await mount(page);
 await page.locator('#view-structure').click();await expect(page.locator('.structure-card').first()).toBeVisible();
 await page.locator('#view-text').click();
 await page.locator('.code-host .cm-content').fill('app LiveRenamed {\n actor Added;\n}\nactor Added {\n entry ping() {}\n}');
 await page.locator('#view-structure').click();
 await expect(page.locator('.structure-tree')).toContainText('LiveRenamed');
 await expect(page.locator('.structure-tree')).toContainText('Added');
 const opened=page.waitForEvent('popup');await page.locator('#detach-structure').click();const popup=await opened;await popup.waitForFunction(()=>window.__ARGENT_DETACHED__);
 await page.locator('#view-text').click();await page.locator('.code-host .cm-content').fill('app AnotherLiveName {\n}');
 await expect(popup.locator('.structure-card').first()).toContainText('AnotherLiveName',{timeout:7000});
 await expect(popup.locator('.structure-tree')).not.toContainText('Added');
 expect(await page.evaluate(()=>Object.values(__FILES__)[0])).toContain('app Sample');
 await popup.getByRole('button',{name:'Dock',exact:true}).click();await expect.poll(()=>popup.isClosed()).toBe(true);
 await expect(page.locator('.structure-card').first()).toContainText('AnotherLiveName');
});
