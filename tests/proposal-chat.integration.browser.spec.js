import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
let server,url;
test.use({browserName:process.env.ARGENT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.ARGENT_BROWSER==='webkit'?undefined:'msedge',viewport:{width:1550,height:1000}});
test.beforeAll(async()=>{server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'error'});await server.listen();url=server.resolvedUrls.local[0];});
test.afterAll(async()=>server?.close());
async function setup(page){
 await page.addInitScript(()=>{
  const root='C:/fixture/project',path=root+'/contract.ag';
  window.fixture={root,path,original:'app Vault {\n    actor Vault {\n        entry claim() {\n            require(self.value > 0);\n        }\n    }\n}\n',calls:[],requests:[],verifications:[],rounds:{},failVerification:false};
  const f=window.fixture;f.files={[path]:f.original};f.first=f.original.replace('require(self.value > 0);','require(self.value > 0); // first draft');f.revised=f.original.replace('require(self.value > 0);','require(self.value > 0); // revised draft');
  const call=(name,args)=>({type:'function_call',name,arguments:JSON.stringify(args),call_id:crypto.randomUUID()}),message=text=>({type:'message',content:[{text}]});
  window.__ARGENT_TEST__={invoke:async(command,args={})=>{
   f.calls.push({command,args:structuredClone(args)});
   if(command==='app_info')return{platform:'windows',resources:'C:/fixture/resources',projectsDir:'C:/fixture/projects',defaultProject:{root,entry:path,app:'Vault'},compiler:'C:/fixture/argentc.exe'};
   if(command==='load_settings')return{language:'en',aiEnabled:true,aiTeamEnabled:true,model:'fixture',maxRequests:4};
   if(command==='list_directory')return[{name:'contract.ag',path:args.path+'/contract.ag',isDirectory:false}];
   if(command==='read_file'){if(args.path in f.files)return f.files[args.path];throw Error('File not found');}
   if(command==='read_ai_file')return f.files[args.projectRoot+'/'+args.path]??null;
   if(command==='write_file'){f.files[args.path]=args.text;return;}
   if(command==='language_request')return{items:[]};
   if(['checkpoint_code_history','save_settings','cancel_api'].includes(command))return [];
   if(command==='verify_ai_proposal'){f.verifications.push(structuredClone(args));return{success:!f.failVerification,compile:{success:!f.failVerification},tests:[],error:f.failVerification?'fixture compiler failure':undefined};}
   if(command==='api_request'){
    f.requests.push(structuredClone(args));
    if(args.body.instructions.includes('read-only reviewer'))return{status:'completed',output:[message('Independent review completed: inspect authorization and missing VM scenarios.')]};
    const question=[...args.body.input].reverse().find(x=>x.role==='user'&&/^(create draft|why reject|revise draft|retest candidate)/.test(x.content))?.content.split('\n')[0]||'';
    const round=f.rounds[question]=(f.rounds[question]||0)+1;
    let output;
    if(question==='create draft')output=round===1?[call('propose_file',{path:'contract.ag',content:f.first})]:round===2?[call('approve_proposal',{decision:'reject',reason:'Missing VM signature tests; keep this candidate pending for discussion.'})]:[message('Compilation passed, supervisor rejected because VM tests are missing.')];
    else if(question==='why reject')output=[message('The signature VM tests are missing. We can revise or test without applying this draft.')];
    else if(question==='revise draft')output=round===1?[call('propose_file',{path:'contract.ag',content:f.revised})]:round===2?[call('approve_proposal',{decision:'approve',reason:'Fresh local compile evidence and all three candidate reviews assessed for this fixture.'})]:[message('Revised draft is ready for explicit user review.')];
    else if(question==='retest candidate')output=round===1?[call('verify_proposal',{scenarios:'[]'})]:round===2?[call('approve_proposal',{decision:'approve',reason:'Rechecked compiler evidence and mandatory reviewer reports.'})]:[message('Retest finished.')];
    else output=[message('No project context used.')];
    return{status:'completed',output};
   }
   throw Error('Fixture command not implemented: '+command);
  }};
 });
 await page.goto(url);await expect(page.locator('.document-tab')).toContainText('contract.ag');
 await page.evaluate(()=>{const a=window.__ARGENT_APP__;a.state.panels.assistant=true;a.applySettings();const show=a.context.showProposal;a.context.showProposal=p=>{window.fixture.inline=p;return show(p);};});
 await page.locator('.ai-share input').check();
}
async function send(page,text){await page.locator('.ai-prompt').fill(text);await page.locator('.ai-prompt').press('Enter');await expect.poll(()=>page.evaluate(()=>window.__ARGENT_APP__.assistant.isBusy())).toBe(false);}
async function unchanged(page){expect(await page.evaluate(()=>({editor:window.__ARGENT_APP__.state.current.text,disk:window.fixture.files[window.fixture.path],original:window.fixture.original,writes:window.fixture.calls.filter(x=>x.command==='write_file').length}))).toEqual(expect.objectContaining({writes:0}));expect(await page.evaluate(()=>window.__ARGENT_APP__.state.current.text===window.fixture.original&&window.fixture.files[window.fixture.path]===window.fixture.original)).toBe(true);}
test('rejected inline draft permits explanation and a freshly verified replacement, then explicit unsaved Apply',async({page})=>{
 await setup(page);await send(page,'create draft');await expect(page.locator('.cm-ai-change')).toHaveCount(1);expect(await page.evaluate(()=>window.fixture.inline.ready)).toBe(false);await unchanged(page);
 await page.getByRole('button',{name:'Show AI change'}).click();const dialog=page.getByRole('dialog',{name:'AI code suggestion'});await expect(dialog).toContainText('supervisor rejected');await expect(dialog.getByRole('button',{name:'Apply all changes'})).toBeDisabled();await dialog.getByRole('button',{name:'Close',exact:true}).click();
 const before=await page.evaluate(()=>window.fixture.requests.length);await send(page,'why reject');expect(await page.evaluate(()=>window.fixture.requests.length)).toBeGreaterThan(before);await expect(page.locator('.ai-transcript')).toContainText('signature VM tests are missing');const followup=await page.evaluate(()=>window.fixture.requests.at(-1).body);expect(JSON.stringify(followup.input)).toContain('first draft');expect(JSON.stringify(followup.input)).toContain('Missing VM signature tests');expect(await page.evaluate(()=>window.fixture.inline.after===window.fixture.first)).toBe(true);await unchanged(page);
 await page.evaluate(()=>window.fixture.old=window.fixture.inline);await send(page,'revise draft');expect(await page.evaluate(()=>window.fixture.inline.ready)).toBe(true);expect(await page.evaluate(()=>window.fixture.inline.after===window.fixture.revised)).toBe(true);expect(await page.evaluate(()=>window.fixture.verifications.length)).toBe(2);
 const reviews=await page.evaluate(()=>window.fixture.requests.filter(x=>x.body.instructions.includes('read-only reviewer')&&JSON.stringify(x.body.input).includes('revised draft')).length);expect(reviews).toBeGreaterThanOrEqual(3);
 await page.evaluate(async()=>{await window.fixture.old.onApply();window.fixture.old.onDiscard();});await unchanged(page);expect(await page.evaluate(()=>window.fixture.inline.after===window.fixture.revised)).toBe(true);
 await page.getByRole('button',{name:'Show AI change'}).click();await expect(dialog.locator('.cm-ai-after pre')).toContainText('revised draft');await dialog.getByRole('button',{name:'Apply all changes'}).click();expect(await page.evaluate(()=>window.__ARGENT_APP__.state.current.text===window.fixture.revised)).toBe(true);expect(await page.evaluate(()=>window.fixture.files[window.fixture.path]===window.fixture.original)).toBe(true);expect(await page.evaluate(()=>window.fixture.calls.some(x=>x.command==='write_file'))).toBe(false);
});
test('failed follow-up revalidation remains blocked while chat is usable',async({page})=>{
 await setup(page);await send(page,'create draft');await page.evaluate(()=>window.fixture.failVerification=true);await send(page,'retest candidate');expect(await page.evaluate(()=>window.fixture.verifications.length)).toBe(2);expect(await page.evaluate(()=>window.fixture.inline.ready)).toBe(false);await unchanged(page);await send(page,'why reject');await expect(page.locator('.ai-prompt')).toBeEnabled();await unchanged(page);
});
test('revoking project consent clears preview and stale callbacks cannot apply',async({page})=>{
 await setup(page);await send(page,'create draft');await page.evaluate(()=>window.fixture.old=window.fixture.inline);await page.locator('.ai-share input').uncheck();await expect(page.locator('.cm-ai-change')).toHaveCount(0);await page.evaluate(()=>window.fixture.old.onApply());await unchanged(page);const count=await page.evaluate(()=>window.fixture.calls.filter(x=>['read_ai_file','verify_ai_proposal'].includes(x.command)).length);await send(page,'why reject');expect(await page.evaluate(()=>window.fixture.calls.filter(x=>['read_ai_file','verify_ai_proposal'].includes(x.command)).length)).toBe(count);const latest=await page.evaluate(()=>window.fixture.requests.at(-1).body);expect(JSON.stringify(latest.input)).not.toContain('first draft');expect(latest.tools.some(x=>x.name==='propose_file')).toBe(false);
});
test('manual source changes cannot reverify the older candidate or overwrite the buffer',async({page})=>{
 await setup(page);await send(page,'create draft');await page.evaluate(()=>{const f=window.fixture;f.old=f.inline;const view=window.__ARGENT_APP__.state.current.editor.view;view.dispatch({changes:{from:view.state.doc.length,insert:'// manual change\n'}});});const manual=await page.evaluate(()=>window.__ARGENT_APP__.state.current.text);await send(page,'retest candidate');expect(await page.evaluate(()=>window.fixture.verifications.length)).toBe(1);await page.evaluate(()=>window.fixture.old.onApply());expect(await page.evaluate(()=>window.__ARGENT_APP__.state.current.text)).toBe(manual);expect(await page.evaluate(()=>window.fixture.files[window.fixture.path]===window.fixture.original)).toBe(true);await expect(page.locator('.ai-prompt')).toBeEnabled();expect(await page.evaluate(()=>window.fixture.calls.some(x=>x.command==='write_file'))).toBe(false);
});
test('switching projects drops old candidate context and invalidates retained callbacks',async({page})=>{
 await setup(page);await send(page,'create draft');await page.evaluate(async()=>{const f=window.fixture;f.old=f.inline;f.files['C:/other/contract.ag']='app Other {}\n';await window.__ARGENT_APP__.loadProject('C:/other',{entry:'C:/other/contract.ag',app:'Other'});await f.old.onApply();f.old.onDiscard();});await expect(page.locator('.cm-ai-change')).toHaveCount(0);await send(page,'why reject');const latest=await page.evaluate(()=>window.fixture.requests.at(-1).body);expect(JSON.stringify(latest.input)).not.toContain('first draft');expect(await page.evaluate(()=>window.__ARGENT_APP__.state.current.text)).toBe('app Other {}\n');expect(await page.evaluate(()=>window.fixture.files[window.fixture.path]===window.fixture.original)).toBe(true);expect(await page.evaluate(()=>window.fixture.calls.some(x=>x.command==='write_file'))).toBe(false);
});


