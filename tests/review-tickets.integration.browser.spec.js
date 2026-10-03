import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import fs from 'node:fs/promises';
let server,url,source;
test.use({browserName:process.env.ARGENT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.ARGENT_BROWSER==='webkit'?undefined:'msedge',viewport:{width:1450,height:930}});
test.beforeAll(async()=>{source=(await fs.readFile('resources/examples/catalog/tickets/tickets.ag','utf8')).replace(/\r\n?/g,'\n');server=await createServer({server:{host:'127.0.0.1',port:0,watch:null,hmr:false},logLevel:'error'});await server.listen();url=server.resolvedUrls.local[0];});
test.afterAll(async()=>server?.close());
test('chat-only Tickets review is corrected into four source markers and prepares a verified edit',async({page})=>{
 await page.addInitScript(({source})=>{
  const root='C:/fixture/project',path=root+'/tickets.ag';window.disk=source;window.requests=[];window.calls=[];let round=0;
  window.findings=[{startLine:34,endLine:34,title:'Seriennummer',message:'Nichtnegative Seriennummern vor der Addition sicherstellen.',suggestion:'require(next_serial >= 0);'},{startLine:38,endLine:38,title:'Ticketbetrag',message:'Ein festes Pfand ist eine fachliche Entscheidung.'},{startLine:55,endLine:57,title:'Einlassautorisierung',message:'Veranstalterfreigabe nur bei entsprechendem Modell erforderlich.'},{startLine:58,endLine:66,title:'Gebundener Ticketwert',message:'Den gewünschten Abschlussweg klären.'}];
  window.candidate=source.replace('        int serial = next_serial;','        require(next_serial >= 0);\n        int serial = next_serial;');
  window.__ARGENT_TEST__={invoke:async(command,args={})=>{window.calls.push({command,args});switch(command){
   case 'app_info':return {platform:'windows',resources:'C:/fixture/resources',projectsDir:'C:/fixture',compiler:'fixture',defaultProject:{root,entry:path,app:'Tickets'}};
   case 'load_settings':return {language:'en',aiEnabled:true,aiTeamEnabled:false,model:'fixture',maxRequests:8};
   case 'list_directory':return [{name:'tickets.ag',path,isDirectory:false}];
   case 'read_file':if(args.path===path)return window.disk;throw Error('File not found');
   case 'read_ai_file':return args.path==='tickets.ag'?window.disk:null;
   case 'write_file':window.disk=args.text;return;
   case 'language_request':return {items:[]};
   case 'checkpoint_code_history':return [];
   case 'verify_ai_proposal':return {success:true,compile:{success:true},tests:[]};
   case 'api_request':round++;window.requests.push(args.body);if(round===1)return {status:'completed',output:[{type:'message',content:[{text:'Permanent editor markers are unavailable; here are four findings marked with ◀ in chat.'}]}]};if(round===2)return {status:'completed',output:[{type:'function_call',name:'mark_review',arguments:JSON.stringify({path:'tickets.ag',findings:JSON.stringify(window.findings)}),call_id:'mark'}]};if(round===3)return {status:'completed',output:[{type:'function_call',name:'propose_file',arguments:JSON.stringify({path:'tickets.ag',content:window.candidate}),call_id:'propose'}]};return {status:'completed',output:[{type:'message',content:[{text:'Review editor annotations.'}]}]};
   default:throw Error('Fixture '+command);
  }}};
 },{source});
 await page.goto(url);await expect(page.locator('.document-tab')).toContainText('tickets.ag');await page.evaluate(()=>{const app=window.__ARGENT_APP__;app.state.panels.assistant=true;app.applySettings();});
 await page.locator('.ai-share input').check();await page.locator('.ai-prompt').fill('Review tickets and mark the findings in the editor');await page.locator('.ai-prompt').press('Enter');
 await expect.poll(()=>page.evaluate(()=>window.__ARGENT_APP__.assistant.isBusy())).toBe(false);
 expect(await page.evaluate(()=>window.requests[1].tool_choice)).toEqual({type:'function',name:'mark_review'});
 expect(await page.evaluate(()=>window.calls.filter(c=>c.command==='write_file'||c.command==='verify_ai_proposal'))).toHaveLength(0);
 for(let index=0;index<4;index++){
  await page.evaluate(index=>{const e=window.__ARGENT_APP__.state.current.editor;e.select(e.view.state.doc.line(window.findings[index].startLine).from);},index);
  const marker=page.locator('.cm-review-marker[data-review-index="'+index+'"]');await expect(marker).toBeVisible();await marker.click();const note=page.getByRole('dialog',{name:'AI review note'});
  await expect(note).toContainText(await page.evaluate(index=>window.findings[index].title,index));await expect(note.getByRole('button',{name:'Apply all changes'})).toHaveCount(0);
  if(index===0)await page.screenshot({path:'test-output/review-tickets-marked.png'});
  await note.getByRole('button',{name:'Close',exact:true}).click();
 }
 expect(await page.evaluate(()=>window.__ARGENT_APP__.state.current.text)).toBe(source);expect(await page.evaluate(()=>window.disk)).toBe(source);
 await page.evaluate(()=>{const e=window.__ARGENT_APP__.state.current.editor;e.select(e.view.state.doc.line(34).from);});await page.locator('.cm-review-marker[data-review-index="0"]').click();await page.getByRole('button',{name:'Prepare change',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__ARGENT_APP__.assistant.isBusy())).toBe(false);
 await page.getByRole('button',{name:'Show AI change',exact:true}).first().click();const proposal=page.getByRole('dialog',{name:'AI code suggestion'});await expect(proposal.locator('.cm-ai-after pre')).toContainText('require(next_serial >= 0)');await proposal.getByRole('button',{name:'Apply all changes',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__ARGENT_APP__.state.current.text)).toBe(await page.evaluate(()=>window.candidate));
 expect(await page.evaluate(()=>window.calls.filter(c=>c.command==='verify_ai_proposal'))).toHaveLength(1);expect(await page.evaluate(()=>window.disk)).toBe(source);await expect(page.locator('.cm-review-marker')).toHaveCount(0);
});
