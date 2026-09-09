import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
const {structure}=createRequire(import.meta.url)('../resources/assets/language/structure-service.js');
let vite,baseUrl;
test.beforeAll(async()=>{vite=await createServer({server:{host:'127.0.0.1',port:1443,strictPort:false,hmr:false,watch:null},logLevel:'error'});await vite.listen();baseUrl=vite.resolvedUrls.local[0];});
test.afterAll(async()=>{await vite?.close();});
test('Stones graph remains clean through repeated pan and zoom with independent detail arrows',async({page})=>{
 const folder=new URL('../resources/examples/catalog/stones/',import.meta.url);
 const documents=await Promise.all((await readdir(folder)).filter(n=>n.endsWith('.ag')).map(async name=>({path:'C:/fixture/stones/'+name,text:await readFile(new URL(name,folder),'utf8')})));
 await page.exposeFunction('analyzeStructure',structure);await page.goto(baseUrl);
 await page.evaluate(async documents=>{document.body.innerHTML='<div id="structure-test" style="width:1100px;height:750px"></div>';document.documentElement.dataset.theme='dark';const {mountStructure}=await import('/frontend/structure.js');window.structure=mountStructure(document.querySelector('#structure-test'),{getDocument:()=>documents.find(d=>d.path.endsWith('/app.ag')),getDocuments:()=>documents,getSettings:()=>({language:'de'}),invoke:(_command,{request})=>window.analyzeStructure(request)});},documents);
 await expect(page.locator('.structure-card').first()).toBeVisible();
 await page.getByRole('button',{name:'Alles aufklappen',exact:true}).click();await page.getByRole('button',{name:'Alles einpassen',exact:true}).click();
 const graph=page.locator('.structure-graph'),svg=graph.locator('svg');
 await expect.poll(()=>graph.locator('.structure-card').count()).toBeGreaterThan(10);
 await page.mouse.move(1,1);
 const initial=await svg.getAttribute('viewBox');
 for(let i=0;i<6;i++){const b=await graph.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down({button:'middle'});await page.mouse.move(b.x+b.width/2+130,b.y+b.height/2-55,{steps:12});await page.mouse.up({button:'middle'});await page.mouse.wheel(0,i%2?240:-240);}
 await expect(svg).not.toHaveAttribute('viewBox',initial);
 await page.getByRole('button',{name:'Alles einpassen',exact:true}).click();await page.mouse.move(1,1);
 const fitted=(await svg.getAttribute('viewBox')).split(' ').map(Number),original=initial.split(' ').map(Number);expect(Math.abs(fitted[2]/original[2]-1)).toBeLessThan(.02);
 for(let i=0;i<4;i++)await page.getByRole('button',{name:'+',exact:true}).click();await page.getByRole('button',{name:'Zur Auswahl',exact:true}).click();await page.mouse.move(1,1);
 await graph.screenshot({path:'qa/structure-stones-pan-zoom.png'});
 // Move every primitive outside the viewport; no old edge pixels may remain.
 const b=await graph.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down({button:'middle'});await page.mouse.move(b.x+9000,b.y+9000,{steps:16});await page.mouse.up({button:'middle'});await page.mouse.move(1,1);
 const empty=await graph.screenshot();await svg.locator(':scope > g').evaluate(e=>e.style.visibility='hidden');expect((await graph.screenshot()).equals(empty)).toBe(true);await svg.locator(':scope > g').evaluate(e=>e.style.visibility='');
 await page.getByRole('button',{name:'Blockdetails',exact:true}).click();await expect(page.locator('.structure-dialog')).toBeVisible();
 const ids=await page.locator('marker').evaluateAll(es=>es.map(e=>e.id));expect(new Set(ids).size).toBe(ids.length);
 expect(await page.locator('marker path').evaluateAll(es=>es.every(e=>/^#[0-9a-f]{6}$/.test(e.getAttribute('fill'))))).toBe(true);
 await page.getByRole('button',{name:'Schließen',exact:true}).click();await page.evaluate(()=>window.structure.dispose());
});
test.use({channel:'msedge',viewport:{width:1200,height:850}});
async function drag(page,selector,dx,dy){const b=await page.locator(selector).boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:8});await page.mouse.up();}
test('structure dividers drag both ways and fit a shrinking outer pane',async({page})=>{
 await page.exposeFunction('analyzeStructure',structure);await page.goto(baseUrl);await page.evaluate(async()=>{document.body.innerHTML='<div id="structure-test" style="width:1000px;height:700px"></div>';const css=document.createElement('link');css.rel='stylesheet';css.href='/frontend/structure.css';document.head.append(css);const {mountStructure}=await import('/frontend/structure.js');const doc={path:'C:/fixture/tickets.ag',text:'state S { int count; } actor Ticket owns S { entry redeem() { require(count == 0); } } app Tickets { actor Ticket; }'};window.structure=mountStructure(document.querySelector('#structure-test'),{getDocument:()=>doc,getDocuments:()=>[doc],getSettings:()=>({language:'de'}),invoke:(_command,{request})=>window.analyzeStructure(request)});});await expect(page.locator('.structure-card').first()).toBeVisible();
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
 const width=()=>page.locator('.structure-sidebar').evaluate(e=>e.getBoundingClientRect().width),height=()=>page.locator('.structure-graph').evaluate(e=>e.getBoundingClientRect().height);
 await expect.poll(width).toBe(250);const initialHeight=await height();await drag(page,'.structure-column-splitter',100,0);await expect.poll(width).toBe(350);await drag(page,'.structure-column-splitter',-170,0);await expect.poll(width).toBe(180);
 await drag(page,'.structure-row-splitter',0,80);await expect.poll(height).toBeCloseTo(initialHeight+80,0);await drag(page,'.structure-row-splitter',0,-130);await expect.poll(height).toBeCloseTo(initialHeight-50,0);
 await page.locator('.structure-column-splitter').focus();await page.keyboard.press('ArrowRight');await expect.poll(width).toBe(190);
 await page.evaluate(()=>{const host=document.querySelector('#structure-test');host.style.width='320px';host.style.height='240px';});
 await expect.poll(()=>page.locator('.structure-main').evaluate(e=>e.getBoundingClientRect().right<=document.querySelector('#structure-test').getBoundingClientRect().right+.5)).toBe(true);
 await expect.poll(()=>page.locator('.structure-main').evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
 await page.screenshot({path:'qa/structure-resize-compact.png'});
 await page.evaluate(()=>{const host=document.querySelector('#structure-test');host.style.width='1000px';host.style.height='700px';});await expect.poll(width).toBe(190);
 await page.screenshot({path:'qa/structure-resize-expanded.png'});await page.evaluate(()=>window.structure.dispose());await expect(page.locator('.structure-view')).toHaveCount(0);
});
test('all visible connections are shown by default and language changes preserve source paths',async({page})=>{
 await page.goto(baseUrl);
 await page.evaluate(async()=>{
  document.body.innerHTML='<div id="structure-test" style="width:1000px;height:700px"></div>';
  const {mountStructure}=await import('/frontend/structure.js');
  window.settings={language:'de'};
  const doc={path:'C:/fixture/Prüfung.ag',text:'fixture'};
  const nodes=[{id:'app',kind:'app',name:'Demo'},{id:'a',parent:'app',kind:'field',name:'Prüfung'},{id:'b',parent:'app',kind:'field',name:'total'}].map(n=>({...n,path:doc.path,start:0,end:7,text:'fixture',detail:n.name}));
  const model={nodes,edges:[{from:'app',to:'a',label:'enthält'},{from:'app',to:'b',label:'enthält'},{from:'a',to:'b',label:'liest Feld'}],sources:[doc]};
  window.structure=mountStructure(document.querySelector('#structure-test'),{getSettings:()=>settings,getDocument:()=>doc,getDocuments:()=>[doc],invoke:async()=>model});
 });
 const edges=page.locator('.structure-graph path[marker-end]');
 await expect(edges).toHaveCount(3);
 await page.locator('.structure-filters summary').click();
 const selection=page.getByLabel('Querverbindungen nur zur Auswahl',{exact:true});
 await expect(selection).not.toBeChecked();await selection.check();await expect(edges).toHaveCount(2);await selection.uncheck();await expect(edges).toHaveCount(3);
 await expect(page.locator('.structure-card title').first()).toContainText('C:/fixture/Prüfung.ag');
 await page.evaluate(()=>settings.language='en');
 await expect(page.getByRole('separator',{name:'Resize structure tree and diagram',exact:true})).toHaveAttribute('title','Resize structure tree and diagram');
 await expect(page.getByRole('textbox',{name:'Filter blocks',exact:true})).toBeVisible();
 await expect(page.getByLabel('Cross-links for selection only',{exact:true})).not.toBeChecked();
 await expect(page.locator('.structure-section')).toHaveText('Shared definition · Prüfung.ag · Changes appear in every reference · Ctrl+S saves');
 await expect(page.locator('.structure-card title').first()).toContainText('C:/fixture/Prüfung.ag');
 await expect(page.locator('.structure-tree-row').filter({hasText:'Field · Prüfung'})).toHaveCount(1);
 await page.evaluate(()=>settings.language='de');
 await expect(page.getByRole('separator',{name:'Strukturbaum und Diagramm aufteilen',exact:true})).toHaveAttribute('title','Strukturbaum und Diagramm aufteilen');
 await expect(page.getByRole('textbox',{name:'Bausteine filtern',exact:true})).toBeVisible();
 await expect(edges).toHaveCount(3);
 await page.evaluate(()=>window.structure.dispose());
});
