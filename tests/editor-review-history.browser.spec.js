import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
let server,url;
test.use({browserName:process.env.ARGENT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.ARGENT_BROWSER==='webkit'?undefined:'msedge',viewport:{width:1450,height:930}});
test.beforeAll(async()=>{server=await createServer({server:{host:'127.0.0.1',port:0,watch:null,hmr:false},logLevel:'error'});await server.listen();url=server.resolvedUrls.local[0];});
test.afterAll(async()=>server?.close());
test('verified assistant proposal applies from editor and persistent history restores without saving',async({page})=>{
 await page.addInitScript(()=>{
  const root='C:/fixture/project',path=root+'/main.ag',text='state S { int count; }\nactor C owns S {\n entry step() { require(count == 0); }\n}\napp A { actor C; }\n';
  window.disk=text;window.candidate=text.replace('count == 0','count >= 0');window.calls=[];let rounds=0;
  const history=()=>JSON.parse(localStorage.getItem('history-test')||'[]');
  window.__ARGENT_TEST__={invoke:async(command,args={})=>{window.calls.push({command,args});switch(command){
   case 'app_info':return {platform:'windows',resources:'C:/fixture/resources',projectsDir:'C:/fixture',compiler:'fixture',defaultProject:{root,entry:path,app:'A'}};
   case 'load_settings':return {language:'en',aiEnabled:true,aiTeamEnabled:false,model:'fixture'};
   case 'list_directory':return [{name:'main.ag',path,isDirectory:false}];
   case 'read_file':if(args.path===path)return window.disk;throw Error('File not found');
   case 'read_ai_file':return args.path==='main.ag'?window.disk:null;
   case 'write_file':window.disk=args.text;return;
   case 'language_request':return {items:[]};
   case 'checkpoint_code_history':{const list=history();if(list[0]?.text!==args.text)list.unshift({id:String(Date.now())+'-'+list.length,createdAt:Date.now(),reason:args.reason,bytes:args.text.length,text:args.text});localStorage.setItem('history-test',JSON.stringify(list));return list;}
   case 'list_code_history':return history();
   case 'read_code_history':return history().find(x=>x.id===args.id).text;
   case 'verify_ai_proposal':return {success:true,compile:{success:true},tests:[]};
   case 'api_request':rounds++;return {status:'completed',output:rounds===1?[{type:'function_call',name:'propose_file',arguments:JSON.stringify({path:'main.ag',content:window.candidate}),call_id:'p'}]:[{type:'message',content:[{text:'Review highlighted changes'}]}]};
   case 'save_settings':return;
   default:throw Error('Fixture: '+command);
  }}};
 });
 await page.goto(url);await expect(page.locator('.document-tab')).toContainText('main.ag');
 await page.evaluate(()=>{const app=window.__ARGENT_APP__;app.state.panels.assistant=true;app.applySettings();});
 await page.locator('.ai-share input').check();await page.locator('.ai-prompt').fill('improve');await page.locator('.ai-prompt').press('Enter');
 await expect.poll(()=>page.evaluate(()=>window.__ARGENT_APP__.assistant.isBusy())).toBe(false);
 await expect(page.locator('.cm-ai-change')).toHaveCount(1);
 await page.getByRole('button',{name:'Show AI change'}).click();const tip=page.getByRole('dialog',{name:'AI code suggestion'});
 await expect(tip.locator('.cm-ai-before pre')).toContainText('count == 0');await expect(tip.locator('.cm-ai-after pre')).toContainText('count >= 0');
 await page.screenshot({path:'test-output/inline-editor-integration-light.png'});
 await tip.getByRole('button',{name:'Apply all changes'}).click();
 await expect.poll(()=>page.evaluate(()=>window.__ARGENT_APP__.state.current.text)).toBe(await page.evaluate(()=>window.candidate));
 expect(await page.evaluate(()=>window.disk)).not.toContain('count >= 0');
 await page.evaluate(async()=>{await window.__ARGENT_APP__.codeHistory.flush();await window.__ARGENT_APP__.codeHistory.open(window.__ARGENT_APP__.state.current);});
 const history=page.getByRole('dialog',{name:'Code history'});await expect(history.locator('.code-history-entry')).toHaveCount(2);
 await history.locator('.code-history-entry').last().click();await expect(history.locator('.code-history-code').last()).toContainText('count == 0');
 await page.screenshot({path:'test-output/code-history-integration-light.png'});
 await history.getByRole('button',{name:'Restore in editor'}).click();await expect(history).not.toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.__ARGENT_APP__.state.current.text===window.disk)).toBe(true);
 expect(await page.evaluate(()=>window.calls.filter(c=>c.command==='write_file'))).toHaveLength(0);
 await page.reload();await expect.poll(()=>page.evaluate(()=>!!window.__ARGENT_APP__?.state.current)).toBe(true);await page.evaluate(async()=>window.__ARGENT_APP__.codeHistory.open(window.__ARGENT_APP__.state.current));
 await expect(page.locator('.code-history-entry')).toHaveCount(3);
});
