import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
let vite,baseUrl;
test.beforeAll(async()=>{vite=await createServer({server:{host:'127.0.0.1',port:1456,strictPort:false,hmr:false,watch:null},logLevel:'error'});await vite.listen();baseUrl=vite.resolvedUrls.local[0];});
test.afterAll(async()=>{await vite?.close();});
test.use({browserName:process.env.ARGENT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.ARGENT_BROWSER==='webkit'?undefined:'msedge',viewport:{width:1450,height:930}});
test.beforeEach(async({page})=>{
 await page.route('**/*plugin-updater*',route=>route.fulfill({contentType:'text/javascript',body:'export async function check(){return window.fixtureUpdate;}'}));
 await page.addInitScript(()=>{
  const root='C:/fixture/project';window.files={[root+'/tickets.ag']:'app Tickets { actor Ticket; }'};window.updateCalls=[];
  window.fixtureUpdate={version:'0.46.0',body:'Fixes',close:async()=>{},downloadAndInstall:async callback=>{updateCalls.push('install');callback({event:'Started',data:{contentLength:10}});await new Promise((resolve,reject)=>{window.finishUpdate=resolve;window.rejectUpdate=reject;});}};
  window.__ARGENT_TEST__={invoke:async(command,args={})=>{
   if(command==='app_info')return {platform:'windows',updatesEnabled:true,resources:'C:/fixture/resources',projectsDir:'C:/fixture/projects',defaultProject:{root,entry:root+'/tickets.ag',app:'Tickets'},compiler:'C:/fixture/bin/argentc.exe'};
   if(command==='load_settings')return {language:'en',darkMode:false,aiEnabled:false};
   if(command==='list_directory')return [{name:'tickets.ag',path:root+'/tickets.ag',isDirectory:false}];
   if(command==='read_file')return files[args.path];
   if(command==='write_file'){updateCalls.push('save');await new Promise((resolve,reject)=>{window.finishSave=resolve;window.rejectSave=reject;});files[args.path]=args.text;return;}
   if(command==='language_request')return {items:[]};
   if(command==='save_settings')return;
   throw Error('Unexpected fixture command: '+command);
  }};
 });
 await page.goto(baseUrl);await expect(page.getByRole('dialog',{name:'New version available'})).toBeVisible();await page.getByRole('button',{name:'Later',exact:true}).click();
 await page.evaluate(()=>window.__ARGENT_APP__.context.updateDocument(window.__ARGENT_APP__.state.current.path,'app Edited { actor Ticket; }'));
 await page.locator('#menu-help>summary').click();await page.locator('#check-updates').click();await page.getByRole('button',{name:'Update now'}).click();
 await expect.poll(()=>page.evaluate(()=>updateCalls)).toEqual(['save']);
});
test('full application saves edits and locks documents throughout download',async({page})=>{
 expect(await page.evaluate(()=>window.__ARGENT_APP__.state.current.editor.view.state.readOnly)).toBe(true);
 await expect(page.locator('#close')).toBeDisabled();
 await page.evaluate(()=>finishSave());await expect.poll(()=>page.evaluate(()=>updateCalls)).toEqual(['save','install']);
 expect(await page.evaluate(()=>files[window.__ARGENT_APP__.state.current.path])).toBe('app Edited { actor Ticket; }');
 expect(await page.evaluate(()=>window.__ARGENT_APP__.state.current.editor.view.state.readOnly)).toBe(true);
 expect(await page.evaluate(()=>{try{window.__ARGENT_APP__.context.updateDocument(window.__ARGENT_APP__.state.current.path,'lost edit');return false;}catch{return true;}})).toBe(true);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('button',{name:'Close',exact:true})).toBeDisabled();
 await page.evaluate(()=>rejectUpdate(Error('fixture download failure')));await expect(page.getByRole('status').filter({hasText:'could not be completed'})).toBeVisible();
 expect(await page.evaluate(()=>window.__ARGENT_APP__.state.current.editor.view.state.readOnly)).toBe(false);
 await expect(page.locator('#close')).toBeEnabled();
});
test('full application never installs after a rejected pending save',async({page})=>{
 await page.evaluate(()=>rejectSave(Error('fixture disk failure')));await expect(page.getByRole('status').filter({hasText:'could not be completed'})).toBeVisible();
 expect(await page.evaluate(()=>updateCalls)).toEqual(['save']);await expect(page.locator('.document-tab')).toContainText('*');
 expect(await page.evaluate(()=>window.__ARGENT_APP__.state.current.editor.view.state.readOnly)).toBe(false);
 expect(await page.evaluate(()=>files[window.__ARGENT_APP__.state.current.path])).toBe('app Tickets { actor Ticket; }');
});
