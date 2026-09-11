import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'vite';
const exec=promisify(execFile),root=process.cwd();
const compiler=path.join(root,'resources/bin/argentc'+(process.platform==='win32'?'.exe':''));
const source='state CounterState { int count; }\nactor Counter owns CounterState { entry increment() emits { next: Counter, } { require(next.value == self.value); CounterState updated = { count: count + 1, }; become next <- Counter(updated); } }\napp FreshApp { actor Counter; }\n';
let server,url;
test.beforeAll(async()=>{server=await createServer({server:{host:'127.0.0.1',port:1457,strictPort:false,hmr:false,watch:null},logLevel:'error'});await server.listen();url=server.resolvedUrls.local[0];});
test.afterAll(async()=>await server?.close());
test.use({browserName:process.env.ARGENT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.ARGENT_BROWSER==='webkit'?undefined:'msedge'});
for(const language of ['de','en'])test('new project first source compiles and later files preserve entry ('+language+')',async({page})=>{
 const base=await fs.mkdtemp(path.join(root,'test-output/new-project-')),seed=path.join(base,'seed'),fresh=path.join(base,'FreshProject'),entry=path.join(fresh,'fresh.ag');await fs.mkdir(seed);await fs.writeFile(path.join(seed,'seed.ag'),source);
 const calls=[];
 await page.exposeFunction('fixtureInvoke',async(command,a={})=>{calls.push({command,args:a});switch(command){
 case 'app_info':return {platform:process.platform==='darwin'?'macos':'windows',resources:path.join(base,'resources'),projectsDir:base,compiler,defaultProject:{root:seed,entry:path.join(seed,'seed.ag'),app:'FreshApp'}};
 case 'load_settings':return {language};
 case 'list_directory':{let rows;try{rows=await fs.readdir(a.path,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}return rows.map(f=>({name:f.name,path:path.join(a.path,f.name),isDirectory:f.isDirectory()}));}
 case 'create_directory':return fs.mkdir(a.path,{recursive:true});
 case 'read_file':try{return await fs.readFile(a.path,'utf8');}catch(e){if(e.code==='ENOENT')throw Error('File not found');throw e;}
 case 'create_file':return fs.writeFile(a.path,a.text,{flag:'wx'});
 case 'write_file':return fs.writeFile(a.path,a.text);
 case 'language_request':return {items:[]};
 case 'build':{const output=path.join(fresh,'build','test');await fs.mkdir(output,{recursive:true});const args=['build',a.entry,'--out',output];if(a.appName)args.push('--app',a.appName);const r=await exec(compiler,args,{windowsHide:true});return {success:true,exitCode:0,stdout:r.stdout,stderr:r.stderr,output,files:[]};}
 default:throw Error('Unexpected fixture command: '+command);
 }});
 await page.addInitScript(()=>{window.__ARGENT_TEST__={invoke:(...args)=>window.fixtureInvoke(...args)};window.__TAURI_INTERNALS__={invoke:async command=>{if(command==='plugin:dialog|save')return window.__NEXT_SAVE_PATH__;throw Error(command);}};});
 await page.goto(url);await expect(page.locator('.document-tab')).toContainText('seed.ag');
 await page.locator('#menu-project>summary').click();await page.locator('#new-project').click();await page.locator('dialog input').fill('FreshProject');await page.locator('dialog .dialog-buttons button').first().click();await expect(page.locator('.document-tab')).toHaveCount(0);
 await page.evaluate(p=>{window.__NEXT_SAVE_PATH__=p;},entry);
 await page.locator('#menu-file>summary').click();await page.locator('#new-file').click();await expect(page.locator('.document-tab')).toContainText('fresh.ag');
 await page.evaluate(text=>{const d=window.__ARGENT_APP__.state.current;d.editor.view.dispatch({changes:{from:0,to:d.editor.view.state.doc.length,insert:text}});},source);
 await page.locator('#compile').click();await expect(page.locator('#status')).toContainText(language==='de'?'Build erfolgreich':'Build succeeded',{timeout:10000});
 expect(await fs.readFile(entry,'utf8')).toBe(source);expect(calls.find(c=>c.command==='build').args.appName).toBe('');await expect(page.locator('#entry-label')).toHaveText('fresh.ag');
 const helper=path.join(fresh,'helper.ag');await page.evaluate(p=>{window.__NEXT_SAVE_PATH__=p;},helper);await page.locator('#menu-file>summary').click();await page.locator('#new-file').click();await expect(page.locator('.document-tab.active')).toContainText('helper.ag');await expect(page.locator('#entry-label')).toHaveText('fresh.ag');
 // A persisted entry wins over tab order and survives moving a project folder.
 let config=JSON.parse(await fs.readFile(path.join(fresh,'.argent-studio.json'),'utf8'));expect(config).toEqual({version:1,entry:'fresh.ag',app:''});
 await page.evaluate(root=>window.__ARGENT_APP__.loadProject(root),fresh);await expect(page.locator('#entry-label')).toHaveText('fresh.ag');
 // Remove preferences and give the second file an independent application.
 await fs.unlink(path.join(fresh,'.argent-studio.json'));await fs.writeFile(helper,source);
 await page.evaluate(root=>window.__ARGENT_APP__.loadProject(root),fresh);expect(await page.evaluate(()=>window.__ARGENT_APP__.state.entry)).toBeNull();
 await page.locator('#compile').click();await expect(page.locator('.build-entry-dialog')).toBeVisible();const buildCount=calls.filter(c=>c.command==='build').length;
 await page.locator('.build-entry-dialog .dialog-buttons button').last().click();expect(calls.filter(c=>c.command==='build').length).toBe(buildCount);await expect(page.locator('#compile')).toBeEnabled();
 await page.locator('#compile').click();await page.locator('.build-entry-dialog select').selectOption(helper);await page.locator('.build-entry-dialog .dialog-buttons button').first().click();await expect(page.locator('#status')).toContainText(language==='de'?'Build erfolgreich':'Build succeeded');
 config=JSON.parse(await fs.readFile(path.join(fresh,'.argent-studio.json'),'utf8'));expect(config.entry).toBe('helper.ag');
 await page.evaluate(root=>window.__ARGENT_APP__.loadProject(root),fresh);await expect(page.locator('#entry-label')).toHaveText('helper.ag');await page.evaluate(file=>window.__ARGENT_APP__.openFile(file),entry);await expect(page.locator('#entry-label')).toHaveText('helper.ag');
 await page.locator('#compile').click();await expect(page.locator('#status')).toContainText(language==='de'?'Build erfolgreich':'Build succeeded');expect(calls.filter(c=>c.command==='build').at(-1).args.entry.replaceAll('\\','/')).toBe(helper.replaceAll('\\','/'));
 // Deleted saved paths are not silently redirected to a different source.
 await fs.unlink(helper);await page.evaluate(root=>window.__ARGENT_APP__.loadProject(root),fresh);await expect(page.locator('#entry-label')).toHaveText('fresh.ag');
 const moved=path.join(base,'MovedProject');await fs.cp(fresh,moved,{recursive:true});await fs.writeFile(path.join(moved,'.argent-studio.json'),JSON.stringify({version:1,entry:'fresh.ag',app:'FreshApp'}));await page.evaluate(root=>window.__ARGENT_APP__.loadProject(root),moved);await expect(page.locator('#entry-label')).toHaveText('fresh.ag');expect((await page.evaluate(()=>window.__ARGENT_APP__.state.entry)).replaceAll('\\','/')).toBe(path.join(moved,'fresh.ag').replaceAll('\\','/'));
});
