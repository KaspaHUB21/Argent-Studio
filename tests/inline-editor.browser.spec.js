import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
test.setTimeout(20000);
test.use({browserName:process.env.ARGENT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.ARGENT_BROWSER==='webkit'?undefined:'msedge'});
let server,url;
test.beforeAll(async()=>{server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:0,watch:null},plugins:[{name:'inline-harness',configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url==='/inline-harness'){res.setHeader('Content-Type','text/html');res.end('<html><body><div id="editor" style="height:600px;width:900px"></div></body></html>');}else next();});}}]});await server.listen();url=server.resolvedUrls.local[0]+'inline-harness';});
test.afterAll(async()=>{await server?.close();});
async function open(page,{readOnly=false}={}){await page.goto(url,{waitUntil:'domcontentloaded'});await page.evaluate(async readOnly=>{const {createEditor}=await import('/frontend/editor.js');window.applyCalls=0;window.discardCalls=0;window.settings={language:'en'};window.editor=createEditor(document.querySelector('#editor'),{text:'a\nold\nkeep\nremove\nz',readOnly,getSettings:()=>window.settings});window.proposal={before:window.editor.getText(),after:'a\nnew\nkeep\nz',ready:true,onApply:()=>window.applyCalls++,onDiscard:()=>window.discardCalls++};window.editor.setProposal(window.proposal);},readOnly);}
test('multiple line marks preview exact changes; keyboard action delegates all changes without editing',async({page})=>{
 await open(page);await expect(page.locator('.cm-ai-change')).toHaveCount(2);
 const marker=page.getByRole('button',{name:'Show AI change'}).first();await marker.focus();await marker.press('Enter');
 const dialog=page.getByRole('dialog',{name:'AI code suggestion'});await expect(dialog).toBeVisible();
 await page.screenshot({path:'test-output/inline-editor-browser/keyboard-light.png'});await expect(dialog.locator('.cm-ai-before pre')).toHaveText('old');await expect(dialog.locator('.cm-ai-after pre')).toHaveText('new');
 await page.getByRole('button',{name:'Apply all changes'}).press('Enter');expect(await page.evaluate(()=>window.applyCalls)).toBe(1);
 expect(await page.evaluate(()=>window.editor.getText())).toBe('a\nold\nkeep\nremove\nz');
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).not.toBeVisible();
});
test('hover displays deletion and pending verification prevents acceptance',async({page})=>{
 await open(page);await page.evaluate(()=>window.editor.setProposal({...window.proposal,ready:false,message:'Checking compiler'}));
 await page.locator('.cm-ai-change').last().hover({position:{x:12,y:10}});const dialog=page.getByRole('dialog',{name:'AI code suggestion'});await expect(dialog).toBeVisible();
 await expect(dialog.locator('.cm-ai-before pre')).toHaveText('remove');await expect(dialog.locator('.cm-ai-after pre')).toHaveText('(no lines)');
 await expect(dialog.getByRole('button',{name:'Apply all changes'})).toBeDisabled();await expect(dialog).toContainText('Checking compiler');expect(await page.evaluate(()=>window.applyCalls)).toBe(0);await page.mouse.move((await dialog.boundingBox()).x+10,(await dialog.boundingBox()).y+10);await expect(dialog).toBeVisible();await page.screenshot({path:'test-output/inline-editor-browser/hover-light.png'});
});
test('editing or readonly invalidates marks and old popup; stale proposals rejected',async({page})=>{
 await open(page);await page.getByRole('button',{name:'Show AI change'}).first().click();
 await page.evaluate(()=>window.editor.view.dispatch({changes:{from:0,insert:'x'}}));
 await expect(page.locator('.cm-ai-change')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>window.editor.setProposal(window.proposal))).toBe(false);
 await page.evaluate(()=>{window.editor.setText(window.proposal.before);window.editor.setProposal(window.proposal);window.editor.setReadOnly(true);});
 await expect(page.locator('.cm-ai-change')).toHaveCount(0);expect(await page.evaluate(()=>window.editor.setProposal(window.proposal))).toBe(false);
});
test('insertion at EOF and escaped markup preview; discard never edits code',async({page})=>{
 await open(page);await page.evaluate(()=>{window.editor.setText('a');window.editor.setProposal({...window.proposal,before:'a',after:'a\n<img src=x onerror=alert(1)>'});});
 await page.getByRole('button',{name:'Show AI change'}).click();const dialog=page.getByRole('dialog');await expect(dialog.locator('.cm-ai-after pre')).toHaveText('<img src=x onerror=alert(1)>');await expect(dialog.locator('img')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Discard all changes'}).click();await expect(page.locator('.cm-ai-change')).toHaveCount(0);expect(await page.evaluate(()=>window.discardCalls)).toBe(1);expect(await page.evaluate(()=>window.editor.getText())).toBe('a');
});

test('dark German popup updates language and preserves keyboard access',async({page})=>{
 await open(page);await page.getByRole('button',{name:'Show AI change'}).first().click();await page.evaluate(()=>{window.settings={language:'de',darkMode:true};window.editor.refresh();});
 await expect(page.getByRole('dialog',{name:'KI-Codevorschlag'})).toBeVisible();await expect(page.getByRole('button',{name:'KI-Änderung anzeigen'})).toHaveCount(2);
 await page.screenshot({path:'test-output/inline-editor-browser/keyboard-dark.png'});
 await page.getByRole('button',{name:'Schließen',exact:true}).click();await page.locator('.cm-ai-change').first().hover({position:{x:12,y:10}});await expect(page.getByRole('dialog',{name:'KI-Codevorschlag'})).toBeVisible();await page.screenshot({path:'test-output/inline-editor-browser/hover-dark.png'});
});

test('explicit clearing and read only invalidate already visible hover previews',async({page})=>{
 await open(page);await page.locator('.cm-ai-change').first().hover({position:{x:12,y:10}});await expect(page.getByRole('dialog')).toBeVisible();await page.evaluate(()=>window.editor.clearProposal());await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.evaluate(()=>window.editor.setProposal(window.proposal));await page.locator('.cm-ai-change').first().hover({position:{x:12,y:10}});await expect(page.getByRole('dialog')).toBeVisible();await page.evaluate(()=>window.editor.setReadOnly(true));await expect(page.getByRole('dialog')).toHaveCount(0);
});
