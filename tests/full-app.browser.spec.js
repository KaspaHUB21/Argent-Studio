import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
let vite,baseUrl;
test.beforeAll(async()=>{vite=await createServer({server:{host:'127.0.0.1',port:1435,strictPort:false,hmr:false,watch:null},logLevel:'error'});await vite.listen();baseUrl=vite.resolvedUrls.local[0];});
test.afterAll(async()=>{await vite?.close();});
test.use({browserName:process.env.ARGENT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.ARGENT_BROWSER==='webkit'?undefined:'msedge',viewport:{width:1450,height:930}});
test.beforeEach(async({page})=>{await page.addInitScript(()=>{const root='C:/fixture/project',text='app Tickets {\n    actor Ticket(owner: pubkey) {\n        entry redeem(signature: sig) {\n            require(checkSig(signature, owner));\n        }\n    }\n}\n';window.__FIXTURE_FILES__={[root+'/tickets.ag']:text};window.__FIXTURE_CALLS__=[];window.__ARGENT_TEST__={invoke:async(command,args={})=>{window.__FIXTURE_CALLS__.push({command,args});if(command==='app_info')return {platform:'windows',resources:'C:/fixture/resources',projectsDir:'C:/fixture/projects',defaultProject:{root,entry:root+'/tickets.ag',app:'Tickets'},compiler:'C:/fixture/bin/argentc.exe'};if(command==='load_settings')return {language:'de',darkMode:false,model:'gpt-6-astra',hasApiKey:false};if(command==='clone_example'||command==='open_example')return {root,entry:root+'/tickets.ag',app:'Tickets'};if(command==='list_directory')return [{name:'build',path:root+'/build',isDirectory:true},{name:'tickets.ag',path:root+'/tickets.ag',isDirectory:false}];if(command==='read_file'){if(args.path in window.__FIXTURE_FILES__)return window.__FIXTURE_FILES__[args.path];throw Error('File not found');}if(command==='write_file'){window.__FIXTURE_FILES__[args.path]=args.text;return;}if(command==='save_settings'||command==='set_secret')return;if(command==='language_request')return {items:[]};if(command==='toolchain_status')return {compiler:'fixture',platform:'windows'};throw Error('Fixture command not implemented: '+command);}};});await page.goto(baseUrl);await expect(page.locator('.document-tab')).toContainText('tickets.ag');});
test('main native layout, focus restore, both themes and settings persistence',async({page})=>{await page.evaluate(()=>{const a=window.__ARGENT_APP__;a.state.settings.aiEnabled=true;a.state.panels.assistant=true;a.applySettings();});await page.screenshot({path:'qa/main-light.png'});await expect(page.locator('.popup-menu')).toBeHidden();const workspace=await page.locator('#workspace').boundingBox();const editor=await page.locator('#center-pane').boundingBox();expect(editor.width).toBeGreaterThan(500);expect(editor.height).toBeGreaterThan(650);await page.locator('#focus').click();await expect(page.locator('#project-pane')).toBeHidden();await expect(page.locator('#assistant-pane')).toBeHidden();await expect(page.locator('#results-pane')).toBeHidden();expect((await page.locator('#center-pane').boundingBox()).width).toBeCloseTo(workspace.width,0);await page.locator('#focus').click();await expect(page.locator('#assistant-pane')).toBeVisible();await page.locator('#settings').click();await page.getByText('Dunkelmodus (aus = Hellmodus)',{exact:true}).click();await page.locator('.settings-footer').getByRole('button',{name:'Speichern',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.screenshot({path:'qa/main-dark.png'});expect(await page.evaluate(()=>window.__FIXTURE_CALLS__.some(c=>c.command==='save_settings'&&c.args.settings.darkMode))).toBe(true);await page.locator('#settings').click();await page.getByRole('tab',{name:'KI',exact:true}).click();await expect(page.getByText('Denkaufwand (Vorgabe: max)',{exact:true})).toBeVisible();await page.locator('.settings-footer').getByRole('button',{name:'Abbrechen',exact:true}).click();});
test('language switches shell and assistant labels without losing editor',async({page})=>{await page.evaluate(()=>{const a=window.__ARGENT_APP__;a.state.settings.aiEnabled=true;a.state.panels.assistant=true;a.applySettings();});await page.locator('#settings').click();await page.getByLabel('Sprache',{exact:true}).selectOption('en');await page.locator('.settings-footer').getByRole('button',{name:'Speichern',exact:true}).click();await expect(page.locator('#save')).toHaveText('Save all');await expect(page.locator('.ai-tabs').getByRole('button',{name:'AI assistant',exact:true})).toBeVisible();await expect(page.locator('.cm-content')).toContainText('app Tickets');await page.locator('#menu-project>summary').click();await page.locator('.examples-menu>summary').click();await expect(page.locator('#example-tickets')).toBeVisible();});
test('workspace splitters resize panes in both directions',async({page})=>{await page.evaluate(()=>{const a=window.__ARGENT_APP__;a.state.settings.aiEnabled=true;a.state.panels.assistant=true;a.applySettings();});
 for(const mode of ['text','structure']){await page.locator('#view-'+mode).click();
 for(const [handle,pane,dx,dy] of [['#workspace > .splitter:nth-child(2)','#project-pane',100,0],['#assistant-splitter','#assistant-pane',-100,0],['#result-splitter','#results-pane',0,-100]]){
  const before=await page.locator(pane).boundingBox();const h=await page.locator(handle).boundingBox();
  await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+dx,h.y+h.height/2+dy,{steps:10});await page.mouse.up();
  const after=await page.locator(pane).boundingBox();expect(dx?after.width:after.height).toBeGreaterThan((dx?before.width:before.height)+70);
  const moved=await page.locator(handle).boundingBox();
  // Start just outside the painted divider to exercise the larger hit target.
  const x=moved.x+(dx?-2:moved.width/2),y=moved.y+(dx?moved.height/2:-2);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-dx,y-dy,{steps:10});await page.mouse.up();
  const restored=await page.locator(pane).boundingBox();expect(dx?restored.width:restored.height).toBeCloseTo(dx?before.width:before.height,0);
  await page.mouse.move(x+150,y+150);expect(await page.locator('body').evaluate(e=>e.className)).not.toMatch(/resizing/);
 }
 }
});


test('project chooser starts in common projects folder',async({page})=>{
 await page.evaluate(()=>{window.__TAURI_INTERNALS__={invoke:async(command,args)=>{window.__DIALOG__={command,args};return null;}};});
 expect(await page.evaluate(()=>window.__FIXTURE_CALLS__.some(c=>c.command==='clone_example'))).toBe(false);
 await page.locator('#menu-project>summary').click();await page.locator('#open-project').click();
 await expect.poll(()=>page.evaluate(()=>window.__DIALOG__?.args?.options?.defaultPath)).toBe('C:/fixture/projects');
});

test('AI is off by default and cannot start chat or billing requests',async({page})=>{
 await expect(page.locator('#assistant-pane')).toBeHidden();await expect(page.locator('#panel-assistant')).toBeDisabled();await expect(page.locator('.ai-prompt')).toBeDisabled();
 await expect(page.locator('.ai-share input')).not.toBeChecked();
 await page.evaluate(async()=>{const app=window.__ARGENT_APP__;app.state.settings.hasAdminKey=true;await app.assistant.refreshBilling();await app.assistant.explain('Do not send this');});
 expect(await page.evaluate(()=>window.__FIXTURE_CALLS__.filter(c=>c.command==='api_request'))).toEqual([]);
 await page.locator('#settings').click();await page.getByRole('tab',{name:'KI',exact:true}).click();
 await page.getByLabel('KI aktivieren',{exact:true}).check();
 await page.locator('.settings-footer').getByRole('button',{name:'Speichern',exact:true}).click();
 await expect(page.locator('.ai-prompt')).toBeEnabled();
 expect(await page.evaluate(()=>window.__FIXTURE_CALLS__.some(c=>c.command==='save_settings'&&c.args.settings.aiEnabled))).toBe(true);
 await page.locator('#settings').click();await page.getByRole('tab',{name:'KI',exact:true}).click();await page.getByLabel('KI aktivieren',{exact:true}).uncheck();await page.locator('.settings-footer').getByRole('button',{name:'Speichern',exact:true}).click();
 await expect(page.locator('.ai-prompt')).toBeDisabled();
});

test('overflow tabs retain full height and Structure opens project source from other file types',async({page})=>{
 await page.evaluate(async()=>{const app=window.__ARGENT_APP__;for(let i=0;i<8;i++){const path='C:/fixture/project/long-file-name-'+i+'.md';window.__FIXTURE_FILES__[path]='# Readme';await app.openFile(path);}});
 const strip=page.locator('#document-tabs');
 expect(await strip.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 const widths=await page.locator('.document-tab').evaluateAll(tabs=>tabs.map(e=>e.getBoundingClientRect().width));expect(Math.max(...widths)).toBeLessThan(190);expect(Math.min(...widths)).toBeGreaterThanOrEqual(110);
 await page.evaluate(async()=>{for(let i=8;i<18;i++){const path='C:/fixture/project/long-file-name-'+i+'.md';window.__FIXTURE_FILES__[path]='# Readme';await window.__ARGENT_APP__.openFile(path);}});
 expect(await strip.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
 expect(await strip.evaluate(e=>[...e.children].every(tab=>tab.getBoundingClientRect().height<=e.clientHeight))).toBe(true);
 await strip.evaluate(e=>e.scrollLeft=e.scrollWidth);
 await page.screenshot({path:'qa/many-document-tabs.png'});
 await expect(page.locator('#view-structure')).toBeEnabled();await page.locator('#view-structure').click();
 await expect(page.locator('.document-tab.active')).toContainText('tickets.ag');
 await expect(page.locator('#view-structure')).toHaveClass(/checked/);
 await page.evaluate(async()=>{window.__FIXTURE_FILES__['C:/fixture/project/artifact.json']='{}';await window.__ARGENT_APP__.openFile('C:/fixture/project/artifact.json');});
 await page.locator('#view-structure').click();await expect(page.locator('.document-tab.active')).toContainText('tickets.ag');
});


test('assistant notices and settings controls follow language in both directions',async({page})=>{
 await page.evaluate(()=>{const app=window.__ARGENT_APP__;app.state.settings.aiEnabled=true;app.state.panels.assistant=true;app.applySettings();});
 await expect(page.locator('.ai-transcript')).toContainText('KI unter Einstellungen');
 for(const language of ['en','de']){
  await page.evaluate(language=>{const app=window.__ARGENT_APP__;app.state.settings.language=language;app.applySettings();},language);
  await expect(page.locator('.ai-transcript')).toContainText(language==='en'?'Enable AI and enter an API key':'KI unter Einstellungen');
  await page.locator('#settings').click();
  const dialog=page.locator('.settings-dialog');
  await expect(dialog.getByRole('button',{name:language==='en'?'Close':'Schließen',exact:true})).toBeVisible();
  await dialog.getByRole('tab',{name:language==='en'?'AI':'KI',exact:true}).click();
  await expect(dialog.locator('option[value="low"]')).toHaveText(language==='en'?'Low':'Niedrig');
  await dialog.getByRole('button',{name:language==='en'?'Close':'Schließen',exact:true}).click();
 }
});

test('example menu reopens existing projects and hides build directories',async({page})=>{
 await page.locator('#menu-project>summary').click();await page.locator('.examples-menu>summary').click();await page.locator('#example-tickets').click();await expect(page.locator('.document-tab')).toContainText('tickets.ag');
 await page.locator('#menu-project>summary').click();await page.locator('.examples-menu>summary').click();await page.locator('#example-tickets').click();
 const calls=await page.evaluate(()=>window.__FIXTURE_CALLS__);expect(calls.filter(c=>c.command==='open_example')).toHaveLength(2);expect(calls.filter(c=>c.command==='clone_example')).toHaveLength(0);
 await expect(page.locator('#project-tree')).not.toContainText('build');expect(await page.evaluate(()=>window.__ARGENT_APP__.state.files.some(f=>f.path.includes('/build')))).toBe(false);
});

for (const language of ['de', 'en']) test(`grouped toolbar navigation and layout in ${language}`, async ({page}) => {
 await page.evaluate(language => {const app=window.__ARGENT_APP__;app.state.settings.language=language;app.applySettings();},language);
 await page.setViewportSize({width:1150,height:800});
 const project=page.locator('#menu-project>summary');
 await expect(project).toHaveText(language==='de'?'Projekt':'Project');
 await project.focus();await project.press('ArrowDown');
 await expect(page.locator('#new-project')).toBeFocused();
 await page.keyboard.press('Escape');await expect(project).toBeFocused();
 await expect(page.locator('#new-project')).toBeHidden();
 await project.click();await page.locator('#menu-build>summary').click();
 await expect(page.locator('#new-project')).toBeHidden();
 await expect(page.locator('#compiler')).toBeVisible();
 await page.locator('#app-name').fill('Tickets');
 await expect(page.locator('#compiler')).toBeVisible();
 await page.screenshot({path:`qa/grouped-build-${language}.png`});
 await page.locator('.cm-content').click();await expect(page.locator('#compiler')).toBeHidden();
 await project.click();await page.locator('.examples-menu>summary').click();
 await expect(page.locator('#example-tickets')).toBeVisible();
 const popup=await page.locator('#menu-project>.app-menu-content').boundingBox();
 expect(popup.x).toBeGreaterThanOrEqual(0);expect(popup.x+popup.width).toBeLessThanOrEqual(1150);
 await page.screenshot({path:`qa/grouped-project-${language}.png`});
 const bar=await page.locator('.main-toolbar').boundingBox();expect(bar.height).toBeLessThan(75);
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{window.__ARGENT_APP__.state.settings.darkMode=true;window.__ARGENT_APP__.applySettings();});
 await expect(page.locator('#menu-view')).toHaveCount(0);
 for (const [id, pane] of [['panel-project','project-pane'],['panel-results','results-pane']]) {
  const button=page.locator(`.viewbar .view-panels #${id}`);
  await expect(button).toBeVisible();
  const visible=await page.locator(`#${pane}`).isVisible();
  await button.click();await expect(page.locator(`#${pane}`)).toBeVisible({visible:!visible});
  await button.click();await expect(page.locator(`#${pane}`)).toBeVisible({visible});
 }
 const panels=await page.locator('.view-panels').boundingBox();
 const views=await page.locator('.viewbar').boundingBox();
 expect(panels.y+panels.height).toBeLessThanOrEqual(views.y+views.height);
 expect(panels.x+panels.width).toBeLessThanOrEqual(1150);
 await expect(page.locator('#panel-assistant')).toBeDisabled();
 await page.screenshot({path:`qa/grouped-view-dark-${language}.png`});
});

for (const language of ['de','en']) test(`project changes replace build files and clear old errors in ${language}`, async ({page}) => {
 await page.evaluate(async language => {
  const a=window.__ARGENT_APP__;a.state.settings.language=language;
  a.state.build={success:true,output:'C:/fixture/project/build/1',files:[{name:'Old.sil',path:'C:/fixture/project/build/1/Old.sil'}]};
  a.state.diagnostics=[{path:'C:/fixture/project/old.ag',line:1,column:1,message:'Old error'}];
  a.applySettings();document.querySelector('#build-output').textContent='Old log';
  const previous=window.__ARGENT_TEST__.invoke;
  window.__ARGENT_TEST__.invoke=async (command,args)=>{
   if(command==='list_directory'&&args.path.startsWith('C:/second')) {
    if(args.path==='C:/second')return [{name:'build',path:'C:/second/build',isDirectory:true}];
    if(args.path==='C:/second/build')return [{name:'2',path:'C:/second/build/2',isDirectory:true}];
    return ['New.sil','artifact.json','manifest.json','editor-build.log'].map(name=>({name,path:'C:/second/build/2/'+name,isDirectory:false}));
   }
   if(command==='read_file'&&args.path.startsWith('C:/second'))return args.path.endsWith('.log')?'Second project log':'{}';
   if(command==='list_directory'&&args.path==='C:/empty')return [];
   return previous(command,args);
  };
  await a.loadProject('C:/second');
 },language);
 await expect(page.locator('#build-artifacts')).toContainText('New.sil');
 await expect(page.locator('#build-artifacts')).not.toContainText('Old.sil');
 await expect(page.locator('#build-errors')).not.toContainText('Old error');
 await expect(page.locator('#build-output')).toHaveText('Second project log');
 expect(await page.evaluate(()=>window.__ARGENT_APP__.state.build.stale)).toBe(true);
 await page.evaluate(()=>window.__ARGENT_APP__.loadProject('C:/empty'));
 await expect(page.locator('#build-artifacts')).toBeEmpty();
 await expect(page.locator('#build-output')).toBeEmpty();
 expect(await page.evaluate(()=>window.__ARGENT_APP__.state.build)).toBe(null);
 await expect(page.locator('.document-tab')).toHaveCount(0);
});

test('expanded structure cards retain their proportions and zoom when resizing build output',async({page})=>{
 await page.evaluate(()=>{
  const previous=window.__ARGENT_TEST__.invoke;
  window.__ARGENT_TEST__.invoke=async(command,args)=>{
   if(command==='language_request') {
    const doc=window.__ARGENT_APP__.state.current;
    const nodes=[{id:'app',kind:'app',name:'Tickets'},{id:'actor',parent:'app',kind:'actor',name:'Ticket'},{id:'entry',parent:'actor',kind:'entry',name:'redeem'}].map(n=>({...n,path:doc.path,start:0,end:doc.text.length,text:doc.text,detail:n.name}));
    return {nodes,edges:[{from:'app',to:'actor',label:'enthält'},{from:'actor',to:'entry',label:'enthält'}],sources:[doc]};
   }
   return previous(command,args);
  };
  window.__ARGENT_APP__.setView('structure');
 });
 const cards=page.locator('.structure-graph .structure-card');await expect(cards.first()).toBeVisible();
 await page.getByRole('button',{name:'Alles aufklappen',exact:true}).click();await expect(cards).toHaveCount(3);
 const card=cards.first().locator('rect');const initial=await card.boundingBox();
 for(const [selector,dx,dy] of [['#result-splitter',0,-130],['#result-splitter',0,210],['.structure-row-splitter',0,60],['.structure-row-splitter',0,-90],['.structure-column-splitter',70,0]]) {
  const divider=await page.locator(selector).boundingBox();
  await page.mouse.move(divider.x+divider.width/2,divider.y+divider.height/2);await page.mouse.down();
  await page.mouse.move(divider.x+divider.width/2+dx,divider.y+divider.height/2+dy,{steps:12});await page.mouse.up();
  await expect.poll(async()=>{const b=await card.boundingBox();return Math.abs(b.width/b.height-initial.width/initial.height);}).toBeLessThan(.01);
  await expect.poll(async()=>Math.abs((await card.boundingBox()).width-initial.width)).toBeLessThan(.5);
  await expect.poll(async()=>Math.abs((await card.boundingBox()).height-initial.height)).toBeLessThan(.5);
  await expect(cards).toHaveCount(3);
 }
 await page.screenshot({path:'qa/structure-build-resize.png'});
});
