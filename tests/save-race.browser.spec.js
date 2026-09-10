import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
let vite,baseUrl;
test.beforeAll(async()=>{vite=await createServer({server:{host:'127.0.0.1',port:1451,strictPort:false,hmr:false,watch:null},logLevel:'error'});await vite.listen();baseUrl=vite.resolvedUrls.local[0];});
test.afterAll(async()=>{await vite?.close();});
test.use({channel:'msedge',viewport:{width:1450,height:930}});
test.beforeEach(async({page})=>{await page.addInitScript(()=>{const root='C:/fixture/project',text='app Tickets {\n    actor Ticket(owner: pubkey) {\n        entry redeem(signature: sig) {\n            require(checkSig(signature, owner));\n        }\n    }\n}\n';window.__FIXTURE_FILES__={[root+'/tickets.ag']:text};window.__FIXTURE_CALLS__=[];window.__ARGENT_TEST__={invoke:async(command,args={})=>{window.__FIXTURE_CALLS__.push({command,args});if(command==='app_info')return {platform:'windows',resources:'C:/fixture/resources',projectsDir:'C:/fixture/projects',defaultProject:{root,entry:root+'/tickets.ag',app:'Tickets'},compiler:'C:/fixture/bin/argentc.exe'};if(command==='load_settings')return {language:'de',darkMode:false,model:'gpt-6-astra',hasApiKey:false};if(command==='clone_example'||command==='open_example')return {root,entry:root+'/tickets.ag',app:'Tickets'};if(command==='list_directory')return [{name:'build',path:root+'/build',isDirectory:true},{name:'tickets.ag',path:root+'/tickets.ag',isDirectory:false}];if(command==='read_file'){if(args.path in window.__FIXTURE_FILES__)return window.__FIXTURE_FILES__[args.path];throw Error('File not found');}if(command==='write_file'){window.__FIXTURE_FILES__[args.path]=args.text;return;}if(command==='save_settings'||command==='set_secret')return;if(command==='language_request')return {items:[]};if(command==='toolchain_status')return {compiler:'fixture',platform:'windows'};throw Error('Fixture command not implemented: '+command);}};});await page.goto(baseUrl);await expect(page.locator('.document-tab')).toContainText('tickets.ag');});

async function delayWrites(page){await page.evaluate(()=>{
 const original=window.__ARGENT_TEST__.invoke;window.pendingWrites=[];window.finished=[];
 window.__ARGENT_TEST__.invoke=async(command,args)=>{
  if(command==='write_file')await new Promise((resolve,reject)=>window.pendingWrites.push({text:args.text,resolve,reject}));
  return original(command,args);
 };
 window.edit=text=>{const app=window.__ARGENT_APP__;app.context.updateDocument(app.state.current.path,text);};
 window.save=()=>{window.__ARGENT_APP__.saveCurrent().then(value=>window.finished.push(value),error=>window.finished.push(error.message));};
});}
async function release(page){await page.evaluate(()=>window.pendingWrites.shift().resolve());}
test('edits during a write remain dirty and the next save persists them',async({page})=>{
 await delayWrites(page);await page.evaluate(()=>{edit('edit A');save();});
 await expect.poll(()=>page.evaluate(()=>pendingWrites.length)).toBe(1);
 await page.evaluate(()=>edit('edit B'));await release(page);
 await expect.poll(()=>page.evaluate(()=>finished)).toEqual([false]);
 expect(await page.evaluate(()=>window.__FIXTURE_FILES__[window.__ARGENT_APP__.state.current.path])).toBe('edit A');
 await expect(page.locator('.document-tab')).toContainText('*');
 await page.evaluate(()=>save());await expect.poll(()=>page.evaluate(()=>pendingWrites.length)).toBe(1);await release(page);
 await expect.poll(()=>page.evaluate(()=>finished)).toEqual([false,true]);
 expect(await page.evaluate(()=>window.__FIXTURE_FILES__[window.__ARGENT_APP__.state.current.path])).toBe('edit B');
 await expect(page.locator('.document-tab')).not.toContainText('*');
});
test('overlapping saves execute in order without a false external conflict',async({page})=>{
 await delayWrites(page);await page.evaluate(()=>{edit('edit A');save();});await expect.poll(()=>page.evaluate(()=>pendingWrites.length)).toBe(1);
 await page.evaluate(()=>{edit('edit B');save();});expect(await page.evaluate(()=>pendingWrites.length)).toBe(1);await release(page);
 await expect.poll(()=>page.evaluate(()=>pendingWrites[0]?.text)).toBe('edit B');await release(page);
 await expect.poll(()=>page.evaluate(()=>finished.length)).toBe(2);
 expect(await page.evaluate(()=>window.__FIXTURE_FILES__[window.__ARGENT_APP__.state.current.path])).toBe('edit B');
 await expect(page.locator('dialog')).toHaveCount(0);await expect(page.locator('.document-tab')).not.toContainText('*');
});
test('close waits for a pending save and keeps newer edits open',async({page})=>{
 await delayWrites(page);await page.evaluate(()=>{edit('edit A');save();});await expect.poll(()=>page.evaluate(()=>pendingWrites.length)).toBe(1);
 await page.locator('#close').click();await expect(page.locator('.document-tab')).toHaveCount(1);
 await page.evaluate(()=>edit('edit B'));await release(page);
 await expect(page.getByRole('button',{name:'Speichern',exact:true})).toBeVisible();await page.getByRole('button',{name:'Speichern',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>pendingWrites.length)).toBe(1);await page.evaluate(()=>edit('edit C'));await release(page);
 await expect(page.locator('.document-tab')).toContainText('*');
 expect(await page.evaluate(()=>window.__ARGENT_APP__.state.current.text)).toBe('edit C');
 expect(await page.evaluate(()=>window.__FIXTURE_FILES__[window.__ARGENT_APP__.state.current.path])).toBe('edit B');
});
test('a failed write keeps the old baseline and can be retried',async({page})=>{
 await delayWrites(page);const before=await page.evaluate(()=>window.__ARGENT_APP__.state.current.diskText);
 await page.evaluate(()=>{edit('new edit');save();});await expect.poll(()=>page.evaluate(()=>pendingWrites.length)).toBe(1);
 await page.evaluate(()=>pendingWrites.shift().reject(Error('Test write failure')));
 await expect.poll(()=>page.evaluate(()=>finished.length)).toBe(1);
 expect(await page.evaluate(()=>window.__ARGENT_APP__.state.current.diskText)).toBe(before);await expect(page.locator('.document-tab')).toContainText('*');
 await page.evaluate(()=>save());await expect.poll(()=>page.evaluate(()=>pendingWrites.length)).toBe(1);await release(page);
 await expect.poll(()=>page.evaluate(()=>finished[1])).toBe(true);await expect(page.locator('.document-tab')).not.toContainText('*');
});

test('a queued save restores text reverted to the old baseline during a pending write',async({page})=>{
 await delayWrites(page);const before=await page.evaluate(()=>window.__ARGENT_APP__.state.current.text);
 await page.evaluate(()=>{edit('temporary edit');save();});await expect.poll(()=>page.evaluate(()=>pendingWrites.length)).toBe(1);
 await page.evaluate(before=>{edit(before);save();},before);await release(page);
 await expect.poll(()=>page.evaluate(()=>pendingWrites[0]?.text)).toBe(before);await release(page);
 await expect.poll(()=>page.evaluate(()=>finished.length)).toBe(2);
 expect(await page.evaluate(()=>window.__FIXTURE_FILES__[window.__ARGENT_APP__.state.current.path])).toBe(before);
 await expect(page.locator('.document-tab')).not.toContainText('*');
});
test('rejecting an external modification conflict leaves both versions intact',async({page})=>{
 await delayWrites(page);await page.evaluate(()=>{edit('editor version');window.__FIXTURE_FILES__[window.__ARGENT_APP__.state.current.path]='external version';save();});
 await page.getByRole('button',{name:'Nein',exact:true}).click();await expect.poll(()=>page.evaluate(()=>finished)).toEqual([false]);
 expect(await page.evaluate(()=>pendingWrites.length)).toBe(0);
 expect(await page.evaluate(()=>window.__FIXTURE_FILES__[window.__ARGENT_APP__.state.current.path])).toBe('external version');
 expect(await page.evaluate(()=>window.__ARGENT_APP__.state.current.text)).toBe('editor version');await expect(page.locator('.document-tab')).toContainText('*');
});
