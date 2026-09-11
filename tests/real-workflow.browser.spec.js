import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'vite';
const exec=promisify(execFile),root=process.cwd(),resources=path.join(root,'resources');
const suffix=process.platform==='win32'?'.exe':'';
let server,url;
test.beforeAll(async()=>{server=await createServer({server:{port:1443,strictPort:false,host:'127.0.0.1',hmr:false}});await server.listen();url=server.resolvedUrls.local[0];});
test.afterAll(async()=>await server?.close());
test.use({browserName:process.env.ARGENT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.ARGENT_BROWSER==='webkit'?undefined:'msedge',viewport:{width:1450,height:900}});
test('complete editor workflow uses real compiler, scanner and VM on isolated files',async({page})=>{
 test.setTimeout(120000);const project=path.join(root,'test-output','workflow-'+Date.now());await fs.cp(path.join(resources,'examples/catalog/tickets'),project,{recursive:true});const ticketPath=path.join(project,'tickets.ag');await fs.writeFile(ticketPath,(await fs.readFile(ticketPath,'utf8')).replace(/\r\n?/g,'\n').replace(/\n/g,'\r\n'));const errors=[];page.on('pageerror',e=>errors.push(e.message));let buildResult;
 async function command(name,a){switch(name){
 case 'app_info':return {resources,dataDir:path.dirname(project),projectsDir:path.dirname(project),compiler:path.join(resources,'bin/argentc'+suffix),platform:process.platform==='win32'?'windows':process.platform==='darwin'?'macos':process.platform};
 case 'load_settings':return {language:'de',darkMode:false};
 case 'clone_example':return {root:project,entry:path.join(project,'tickets.ag'),app:'Tickets'};
 case 'list_directory':return Promise.all((await fs.readdir(a.path,{withFileTypes:true})).map(f=>({name:f.name,path:path.join(a.path,f.name),isDirectory:f.isDirectory()})));
 case 'read_file':return fs.readFile(a.path,'utf8');
 case 'write_file':await fs.mkdir(path.dirname(a.path),{recursive:true});return fs.writeFile(a.path,a.text);
 case 'language_request':{const result=await new Promise((resolve,reject)=>{const child=execFile(path.join(resources,'bin/runtime/node'+suffix),[path.join(resources,'assets/language/studio-service.js')],{maxBuffer:8e6},(e,stdout)=>e?reject(e):resolve(stdout));child.stdin.end(JSON.stringify({...a.request,standardLibrary:path.join(resources,'toolchains/argent-master/std/core.ag')}));});return JSON.parse(result);}
 case 'build':{const output=path.join(project,'build',String(Date.now()));await fs.mkdir(output,{recursive:true});const args=['build',a.entry,'--out',output];if(a.appName)args.push('--app',a.appName);let r;try{r=await exec(path.join(resources,'bin/argentc'+suffix),args,{maxBuffer:8e6});r.code=0;}catch(e){r=e;}const files=(await fs.readdir(output,{withFileTypes:true,recursive:true})).filter(f=>f.isFile()).map(f=>({name:f.name,path:path.join(f.parentPath||output,f.name),isDirectory:false}));return buildResult={exitCode:r.code,stdout:r.stdout,stderr:r.stderr,output,success:r.code===0,files};}
 case 'inspect':return {...await exec(path.join(resources,'bin/argentc'+suffix),['inspect',a.output]),exitCode:0};
 case 'run_scenario_json':case 'run_scenario':{const result=await new Promise((resolve,reject)=>{const child=execFile(path.join(resources,'bin/ArgentTestRunner-v1'+suffix),[],{maxBuffer:8e6},(e,stdout,stderr)=>e?reject(Error(stderr)):resolve(stdout));child.stdin.end(a.scenarioJson?'{"artifact":'+JSON.stringify(a.artifact)+',"scenario":'+a.scenarioJson+'}':JSON.stringify({artifact:a.artifact,scenario:a.scenario}));});return JSON.parse(result);}
 case 'cancel_operation':return;
 default:throw Error('Unknown integration command '+name);
 }}
 await page.exposeFunction('realCommand',command);await page.addInitScript(()=>window.__ARGENT_TEST__={invoke:(name,args)=>window.realCommand(name,args)});await page.goto(url);await expect(page.locator('.document-tab')).toContainText('tickets.ag');
 await page.locator('#compile').click();await expect(page.locator('#status')).toContainText('Build erfolgreich',{timeout:30000});await expect(page.locator('#build-artifacts')).toContainText('Bytes');
 await expect(page.locator('#project-tree .file-row.selected .file-name')).toHaveText('tickets.ag');
 await expect(page.locator('.artifact-group').first()).toContainText('VERTRÄGE');
 await expect(page.locator('.artifact-group .file-size').first()).toContainText('349 Bytes');
 await page.evaluate(()=>{window.__ARGENT_APP__.state.settings.language='en';window.__ARGENT_APP__.applySettings();});
 await expect(page.locator('.artifact-status')).toContainText('Build succeeded');
 await expect(page.locator('.artifact-group').first()).toContainText('CONTRACTS');
 await expect(page.locator('#status')).toContainText('Build succeeded');
 await expect(page.locator('#project-splitter')).toHaveAttribute('aria-label','Project width');
 await expect(page.locator('.file-size').first()).toHaveAttribute('title','Compiled bytecode template');
 await page.evaluate(()=>{window.__ARGENT_APP__.state.settings.language='de';window.__ARGENT_APP__.applySettings();});
 await expect(page.locator('.artifact-group').first()).toContainText('VERTRÄGE');
 await page.evaluate(()=>{window.__ARGENT_APP__.state.settings.darkMode=true;window.__ARGENT_APP__.applySettings();});
 await page.locator('#project-pane').screenshot({path:'qa/project-explorer-refined.png'});await page.locator('#build-artifacts').screenshot({path:'qa/build-explorer-refined.png'});
 await page.evaluate(()=>{window.__ARGENT_APP__.state.settings.darkMode=false;window.__ARGENT_APP__.applySettings();});
 await expect(page.locator('.document-tab')).not.toContainText('*');expect(await page.evaluate(()=>{const d=window.__ARGENT_APP__.state.current;return d.text===d.editor.getText()&&d.text.length===d.editor.view.state.doc.length;})).toBe(true);const initial=await page.evaluate(()=>window.__ARGENT_APP__.state.current.text);await page.evaluate(()=>{const d=window.__ARGENT_APP__.state.current;d.editor.view.dispatch({changes:{from:d.text.length,insert:'\n// workflow edit'}});});await expect(page.locator('.document-tab')).toContainText('*');await page.keyboard.press('Control+s');await expect(page.locator('.document-tab')).not.toContainText('*');expect(await fs.readFile(path.join(project,'tickets.ag'),'utf8')).toContain('// workflow edit');
 await page.locator('#compile').click();await expect(page.locator('#status')).toContainText('Build erfolgreich',{timeout:30000});
 await page.locator('#view-structure').click();await page.locator('.structure-card').first().waitFor();const fragmentEditor=page.locator('.structure-fragment-host .cm-editor');const fragmentBefore=await fragmentEditor.innerText();await page.evaluate(()=>{window.__ARGENT_APP__.state.settings.darkMode=true;window.__ARGENT_APP__.applySettings();});const darkColor=await fragmentEditor.evaluate(e=>getComputedStyle(e).backgroundColor);await page.evaluate(()=>{window.__ARGENT_APP__.state.settings.darkMode=false;window.__ARGENT_APP__.applySettings();});await expect(fragmentEditor).toHaveCSS('background-color','rgb(255, 255, 255)');expect(darkColor).not.toBe('rgb(255, 255, 255)');expect(await fragmentEditor.innerText()).toBe(fragmentBefore);await page.screenshot({path:'qa/integrated-structure.png'});await page.locator('#test-transaction').click();await page.locator('.transaction-dialog').waitFor();
 // Exercise Issuer.issue directly through the expert JSON editor, including invalid syntax.
 await page.locator('.transaction-dialog select').first().selectOption({label:'Issuer · issue'});
 await page.locator('.transaction-expert-toggle').click();
 const issuerJson=page.locator('.transaction-json'),issuerScenario=JSON.parse(await issuerJson.inputValue());
 await issuerJson.fill('{ invalid json');await page.getByRole('button',{name:'JSON anwenden',exact:true}).click();
 await expect(page.locator('.transaction-result')).toHaveValue(/Ungültiges JSON:/);
 await expect(issuerJson).toHaveValue('{ invalid json');
 issuerScenario.outputs.find(o=>o.actor==='Issuer').state.next_serial=issuerScenario.inputs[0].state.next_serial+1;
 await issuerJson.fill(JSON.stringify(issuerScenario,null,2));await page.getByRole('button',{name:'JSON anwenden',exact:true}).click();
 await page.getByRole('button',{name:'Transaktion prüfen',exact:true}).click();await expect(page.locator('.transaction-result')).toHaveValue(/BESTANDEN/,{timeout:30000});
 await page.screenshot({path:'qa/tickets-issuer-expert-passed.png'});
 const savedScenario=path.join(project,'tickets-issue-scenario.json');await page.evaluate(file=>{window.__TAURI_INTERNALS__={invoke:async()=>file};},savedScenario);
 await page.getByRole('button',{name:'Szenario speichern',exact:true}).click();await expect.poll(async()=>{try{return JSON.parse(await fs.readFile(savedScenario,'utf8'));}catch{return null;}}).toEqual(issuerScenario);
 await issuerJson.fill('{}');await page.getByRole('button',{name:'Szenario laden',exact:true}).click();await expect.poll(async()=>JSON.parse(await issuerJson.inputValue())).toEqual(issuerScenario);

 await page.locator('.transaction-expert-toggle').click();
 const selects=page.locator('.transaction-dialog select');await selects.first().selectOption({label:'Ticket · redeem'});await page.locator('.transaction-card.outputs input').evaluateAll(inputs=>{const i=inputs.find(i=>i.previousElementSibling?.textContent?.includes('redeemed')||i.closest('label')?.textContent.includes('redeemed'));if(i){i.value='1';i.dispatchEvent(new Event('input',{bubbles:true}));}}).catch(()=>{});
 await page.getByRole('button',{name:'Expertenmodus',exact:true}).click();const json=page.locator('.transaction-json');const scenario=JSON.parse(await json.inputValue());scenario.outputs.forEach(o=>{if(o.actor==='Ticket')o.state.redeemed=1;});await json.fill(JSON.stringify(scenario,null,2));await page.locator('.transaction-expert-toggle').click();await expect(page.locator('.transaction-values')).toBeVisible();await expect(page.locator('.transaction-expert-toggle')).toHaveAttribute('aria-expanded','false');await page.locator('.transaction-expert-toggle').click();await expect(page.locator('.transaction-advanced')).toBeVisible();expect(JSON.parse(await json.inputValue()).outputs).toEqual(scenario.outputs);await page.getByRole('button',{name:'Transaktion prüfen',exact:true}).click();await expect(page.locator('.transaction-result')).toHaveValue(/BESTANDEN/,{timeout:30000});await page.screenshot({path:'qa/integrated-vm-passed.png'});await page.evaluate(()=>{window.__ARGENT_APP__.state.settings.language='en';window.__ARGENT_APP__.applySettings();});await expect(page.locator('.transaction-close')).toHaveAttribute('aria-label','Close');await page.evaluate(()=>{window.__ARGENT_APP__.state.settings.language='de';window.__ARGENT_APP__.applySettings();});await expect(page.locator('.transaction-close')).toHaveAttribute('aria-label','Schließen');await page.setViewportSize({width:900,height:600});await page.locator('.transaction-dialog').evaluate(e=>e.scrollTop=e.scrollHeight);const closeBox=await page.locator('.transaction-close').boundingBox();expect(closeBox.x+closeBox.width).toBeLessThanOrEqual(900);expect(closeBox.y).toBeGreaterThanOrEqual(0);await page.locator('.transaction-close').click();await expect(page.locator('.transaction-dialog')).toHaveCount(0);
 await page.locator('#view-text').click();await page.evaluate(()=>{const d=window.__ARGENT_APP__.state.current;window.__ARGENT_APP__.context.updateDocument(d.path,d.text+'\ninvalid invalid invalid');});await page.locator('#compile').click();await expect(page.locator('#status')).toContainText('Build fehlgeschlagen',{timeout:30000});expect(await page.evaluate(()=>window.__ARGENT_APP__.state.build.success)).toBe(false);expect(errors).toEqual([]);await fs.writeFile(path.join(project,'tickets.ag'),initial);
});
