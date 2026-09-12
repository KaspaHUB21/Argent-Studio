import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const {structure}=createRequire(import.meta.url)('../resources/assets/language/structure-service.js');
let server,url;
test.use({browserName:process.env.ARGENT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.ARGENT_BROWSER==='webkit'?undefined:'msedge',viewport:{width:1450,height:930}});
test.beforeAll(async()=>{server=await createServer({server:{host:'127.0.0.1',port:1483,strictPort:false,hmr:false,watch:null},logLevel:'error'});await server.listen();url=server.resolvedUrls.local[0];});
test.afterAll(()=>server?.close());
for(const detached of [false,true])test('editing unopened imported code keeps one document visible and supports undo/save '+(detached?'detached':'embedded'),async({page})=>{
 const root=path.resolve('test-output/import-edit-'+Date.now()),entry=path.join(root,'app.ag'),lib=path.join(root,'counter.ag');await fs.mkdir(root,{recursive:true});
 const original='state S { int count; }\nactor Counter owns S { entry step() { require(count == 0); } }\n';
 await fs.writeFile(entry,'import "./counter.ag";\napp Example { actor Counter; }\n');await fs.writeFile(lib,original);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('backend',async(command,a={})=>{
  if(command==='app_info')return {platform:'windows',version:'test',resources:path.resolve('resources'),projectsDir:root,defaultProject:{root,entry}};
  if(command==='load_settings')return {language:'en',aiEnabled:false};
  if(command==='save_settings')return;
  if(command==='list_directory')return [{path:entry,name:'app.ag',isDirectory:false},{path:lib,name:'counter.ag',isDirectory:false}];
  if(command==='read_file')return fs.readFile(a.path,'utf8');
  if(command==='write_file'){await fs.writeFile(a.path,a.text);return;}
  if(command==='language_request')return a.request.mode==='structure'?structure(a.request):{items:[]};
  if(command==='read_ai_file')return fs.readFile(path.join(root,a.path),'utf8');
  throw Error('Unexpected command '+command);
 });
 await page.addInitScript(()=>{if(!new URLSearchParams(location.search).has('window'))window.__ARGENT_TEST__={invoke:(c,a)=>window.backend(c,a)};});
 await page.goto(url);await page.waitForFunction(()=>window.__ARGENT_APP__);await page.locator('#view-structure').click();await expect(page.locator('.structure-card').first()).toBeVisible();
 expect(await page.evaluate(()=>__ARGENT_APP__.state.documents.length)).toBe(1);
 let surface=page;if(detached){const popup=page.waitForEvent('popup');await page.locator('#detach-structure').click();surface=await popup;await surface.waitForFunction(()=>window.__ARGENT_DETACHED__);}
 await surface.getByRole('button',{name:'Expand all',exact:true}).click();
 await surface.locator('.structure-card[data-kind=check]').first().click();
 const editor=surface.locator('.structure-fragment-host .cm-content');await expect(editor).toContainText('require(count == 0)');

 await editor.fill('require(count == 1);');
 await expect.poll(()=>page.evaluate(()=>__ARGENT_APP__.state.documents.length)).toBe(2);
 await expect(page.locator('.document-host:visible')).toHaveCount(1);
 await expect(page.locator('.code-host:visible')).toHaveCount(0);
 await expect(editor).toContainText('require(count == 1)');
 expect(await page.evaluate(()=>__ARGENT_APP__.state.current.path)).toBe(entry);
 await editor.press('Control+z');await expect.poll(()=>page.evaluate(p=>__ARGENT_APP__.state.documents.find(d=>d.path===p).text,lib)).toBe(original);
 await expect(editor).toContainText('require(count == 0)');
 await editor.press('Control+Shift+z');await expect(editor).toContainText('require(count == 1)');
 await editor.fill('require(count == 2);');await expect.poll(()=>page.evaluate(p=>__ARGENT_APP__.state.documents.find(d=>d.path===p).text,lib)).toContain('count == 2');
 await page.locator('#save').click();await expect.poll(()=>fs.readFile(lib,'utf8')).toContain('count == 2');
 await expect(editor).toContainText('require(count == 2)');await expect(page.locator('.document-host:visible')).toHaveCount(1);
 await surface.screenshot({path:'qa/import-edit-'+(detached?'detached':'embedded')+'.png'});
 expect(errors).toEqual([]);
});
