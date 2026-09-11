import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
let vite,url;
test.beforeAll(async()=>{vite=await createServer({server:{host:'127.0.0.1',port:1468,strictPort:false,hmr:false,watch:null},logLevel:'error'});await vite.listen();url=vite.resolvedUrls.local[0];});
test.afterAll(async()=>vite?.close());
test.use({browserName:process.env.ARGENT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.ARGENT_BROWSER==='webkit'?undefined:'msedge'});
async function mount(page,{text='',language='en',darkMode=false,ag=true,readOnly=false,completions=[]}={}){
 const external=[];
 page.on('request',request=>{if(!request.url().startsWith(url)&&!request.url().startsWith('data:'))external.push(request.url());});
 await page.route('**/live-editor-fixture',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0}#editor{height:260px;width:850px}</style><div id="editor"></div>'}));
 await page.goto(url+'live-editor-fixture');
 await page.evaluate(async options=>{const {createEditor}=await import('/frontend/editor.js');const settings={language:options.language,darkMode:options.darkMode,aiEnabled:false,wordWrap:false};window.liveFixture={settings,changes:[],editor:createEditor(document.querySelector('#editor'),{text:options.text,readOnly:options.readOnly,getSettings:()=>settings,language:options.ag?async()=>({items:options.completions}):undefined,onChange:text=>window.liveFixture.changes.push(text)})};}, {text,language,darkMode,ag,readOnly,completions});
 return external;
}
async function select(page,pos){await page.evaluate(pos=>window.liveFixture.editor.select(pos),pos);}
async function documentText(page){return page.evaluate(()=>window.liveFixture.editor.getText());}
async function replace(page,text,pos=text.length){await page.evaluate(({text,pos})=>{const e=window.liveFixture.editor;e.setText(text);e.select(pos);},{text,pos});}
const functionSource='fn total(int amount, int fee) -> int {\n    return amount + fee;\n}\n';

for(const language of ['en','de'])for(const darkMode of [false,true]){
 test(`local live signature and matching names (${language}, ${darkMode?'dark':'light'})`,async({page})=>{
  const text=functionSource+'fn use_total() -> int {\n    return total(1, 2);\n}\n';
  const external=await mount(page,{text,language,darkMode});
  await select(page,text.indexOf('total(1,')+'total(1, '.length);
  await expect(page.locator('.cm-live-signature')).toBeVisible();
  await expect(page.locator('.cm-live-active-parameter')).toContainText('fee');
  await select(page,text.indexOf('total(1, 2)')+'total(1, 2)'.length);
  await expect(page.locator('.cm-live-signature')).not.toBeVisible();
  await select(page,text.indexOf('amount +')+2);
  await expect(page.locator('.cm-live-occurrence')).toHaveCount(2);
  expect(await documentText(page)).toBe(text);
  expect(external).toEqual([]);
 });
}

test('non-AG and read-only documents do not offer editing suggestions',async({page})=>{
 const text=functionSource+'fn use_total() -> int {\n    tot';
 await mount(page,{text,ag:false});await select(page,text.length);
 await expect(page.locator('.cm-live-ghost')).toHaveCount(0);
 await expect(page.locator('.cm-live-signature')).toHaveCount(0);
 await expect(page.locator('.cm-live-diagnostic-marker')).toHaveCount(0);
 await mount(page,{text,readOnly:true});await select(page,text.length);
 await expect(page.locator('.cm-live-ghost')).toHaveCount(0);
 await page.keyboard.type('al');expect(await documentText(page)).toBe(text);
});

test('occurrences respect nested shadowing and exclude comments and strings',async({page})=>{
 const text='fn sample(int amount) -> int {\n    require(amount > 0);\n    if (true) {\n        int amount = 2;\n        require(amount > 1);\n    }\n    // amount\n    return amount;\n}\n';
 await mount(page,{text});await select(page,text.indexOf('amount > 1')+2);
 await expect(page.locator('.cm-live-occurrence')).toHaveCount(2);
 await select(page,text.indexOf('return amount')+'return am'.length);
 await expect(page.locator('.cm-live-occurrence')).toHaveCount(3);
});

test('inline completion accepts with Tab, dismisses with Escape and leaves indentation usable',async({page})=>{
 const text=functionSource+'fn use_total() -> int {\n    tot\n}\n';
 await mount(page,{text});const pos=text.indexOf('    tot')+7;await select(page,pos);
 await expect(page.locator('.cm-live-ghost')).toHaveText('al');
 await page.keyboard.press('Escape');await expect(page.locator('.cm-live-ghost')).toHaveCount(0);
 expect(await documentText(page)).toBe(text);
 // A fresh edit requests another suggestion; accepting changes only the suffix.
 await page.keyboard.press('Backspace');await page.keyboard.type('t');
 await expect(page.locator('.cm-live-ghost')).toHaveText('al');await page.keyboard.press('Tab');
 expect(await documentText(page)).toBe(text.replace('    tot\n','    total\n'));
 await page.evaluate(()=>window.liveFixture.editor.undo());expect(await documentText(page)).toBe(text);
 const blank='fn use_total() -> int {\n\n}\n';await replace(page,blank,blank.indexOf('\n')+1);
 await page.keyboard.press('Tab');expect(await documentText(page)).toContain('\n    \n');
});

test('diagnostics wait for a pause, disappear immediately after edits and fixes are undoable',async({page})=>{
 await mount(page,{text:'app Sample {}'});
 await replace(page,'app Sample {}}');
 await expect(page.locator('.cm-live-diagnostic-marker')).toHaveCount(0);
 await expect(page.locator('.cm-live-diagnostic-marker')).toHaveCount(1,{timeout:2500});
 await page.locator('.cm-live-diagnostic-marker').click();
 await expect(page.locator('.cm-live-diagnostic-popup')).toContainText('Unexpected closing');
 await page.locator('.cm-live-fix').click();expect(await documentText(page)).toBe('app Sample {}');
 await expect(page.locator('.cm-live-diagnostic-marker')).toHaveCount(0);
 await page.evaluate(()=>window.liveFixture.editor.undo());expect(await documentText(page)).toBe('app Sample {}}');
 await expect(page.locator('.cm-live-diagnostic-marker')).toHaveCount(1,{timeout:2500});
 await replace(page,'app Sample {}');await expect(page.locator('.cm-live-diagnostic-marker')).toHaveCount(0);
});

test('quickfix language changes and read-only state prevents mutation',async({page})=>{
 await mount(page,{text:'app Sample {}}',language:'de',darkMode:true});
 await expect(page.locator('.cm-live-diagnostic-marker')).toHaveCount(1,{timeout:2500});await page.locator('.cm-live-diagnostic-marker').click();
 await expect(page.locator('.cm-live-diagnostic-popup')).toContainText('Unerwartete');
 await page.evaluate(()=>{const f=window.liveFixture;f.settings.language='en';f.settings.darkMode=false;f.editor.refresh();});
 await page.locator('.cm-live-diagnostic-marker').click();await expect(page.locator('.cm-live-diagnostic-popup')).toContainText('Unexpected');
 await page.evaluate(()=>window.liveFixture.editor.setReadOnly(true));
 const fix=page.locator('.cm-live-fix');if(await fix.count())await expect(fix).toBeDisabled();
 expect(await documentText(page)).toBe('app Sample {}}');
});

test('sticky context follows scrolling without changing the document or selection',async({page})=>{
 const text='actor Ledger owns LedgerState {\n    entry update(int amount) {\n'+Array.from({length:65},(_,i)=>'        require(amount > '+i+');').join('\n')+'\n    }\n}\n';
 await mount(page,{text});await select(page,0);await expect(page.locator('.cm-live-sticky')).not.toBeVisible();
 await page.locator('.cm-scroller').evaluate(el=>{el.scrollTop=650;});
 await expect(page.locator('.cm-live-sticky')).toBeVisible();await expect(page.locator('.cm-live-sticky')).toContainText('update');
 expect(await documentText(page)).toBe(text);expect(await page.evaluate(()=>window.liveFixture.editor.view.state.selection.main.head)).toBe(0);
 await page.locator('.cm-scroller').evaluate(el=>{el.scrollTop=0;});await expect(page.locator('.cm-live-sticky')).not.toBeVisible();
});


test('paired delimiters and the active block guide follow ordinary typing',async({page})=>{
 const text='fn run() {\n    \n}\n';await mount(page,{text});await select(page,text.indexOf('    ')+4);
 await expect(page.locator('.cm-live-block-guide')).not.toHaveCount(0);
 await page.keyboard.type('require(');expect(await documentText(page)).toContain('require()');
 await page.keyboard.type('true)');expect(await documentText(page)).toContain('require(true)');
 expect(await documentText(page)).not.toContain('true))');
});

test('destroying a pending editor cancels delayed diagnostics',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await mount(page,{text:'app Pending {'});
 await page.evaluate(()=>{window.liveFixture.editor.destroy();document.querySelector('#editor').remove();});
 // Wait beyond the documented debounce to detect callbacks using a destroyed view.
 await page.waitForTimeout(700);expect(errors).toEqual([]);
});

test('explicit completion has priority over the inline suggestion',async({page})=>{
 const text='fn run() { int balance = 1; bal }';await mount(page,{text,completions:[{name:'balanced',kind:'variable',detail:'Explicit service completion'}]});
 await select(page,text.indexOf('bal }')+3);await expect(page.locator('.cm-live-ghost')).toHaveText('ance');
 await page.evaluate(()=>window.liveFixture.editor.complete());await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
 await expect(page.locator('.cm-live-ghost')).toHaveCount(0);await page.waitForTimeout(100);await page.keyboard.press('Tab');
 expect(await documentText(page)).toBe(text.replace('bal }','balanced }'));
});

test('blur hides inline help and Escape dismisses the current parameter hint',async({page})=>{
 const text=functionSource+'fn run() { return total(1, 2); }';await mount(page,{text});
 const call=text.indexOf('total(1,')+'total(1, '.length;await select(page,call);await expect(page.locator('.cm-live-signature')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('.cm-live-signature')).not.toBeVisible();
 await select(page,call-1);await select(page,call);await expect(page.locator('.cm-live-signature')).toBeVisible();
 await page.evaluate(async()=>{const {createEditor}=await import('/frontend/editor.js');const host=document.createElement('div');document.body.append(host);window.otherEditor=createEditor(host,{text:'app Other {}',language:async()=>({items:[]})});window.otherEditor.focus();});
 await expect(page.locator('.cm-live-signature')).not.toBeVisible();
 const ghost='fn run() { int balance = 1; bal }';await replace(page,ghost,ghost.indexOf('bal }')+3);await expect(page.locator('.cm-live-ghost')).toHaveText('ance');
 await page.evaluate(()=>window.otherEditor.focus());await expect(page.locator('.cm-live-ghost')).toHaveCount(0);
});

test('unfinished active-line opening delimiter stays quiet until leaving the line',async({page})=>{
 await mount(page,{text:'app Draft {'});await select(page,11);
 await page.waitForTimeout(700);await expect(page.locator('.cm-live-diagnostic-marker')).toHaveCount(0);
 await page.keyboard.insertText('\n');await expect(page.locator('.cm-live-diagnostic-marker')).toHaveCount(1,{timeout:2500});
});

test('a 3000-line source remains responsive while typing',async({page})=>{
 const text='fn large(int amount) -> int {\n'+Array.from({length:3000},(_,i)=>'    int value_'+i+' = amount + '+i+';').join('\n')+'\n    return amount;\n}\n';
 await mount(page,{text});await select(page,text.indexOf('return amount')+'return amount'.length);
 const elapsed=await page.evaluate(()=>{const e=window.liveFixture.editor,v=e.view,start=performance.now();v.dispatch(v.state.replaceSelection(' + 1'));return performance.now()-start;});
 expect(elapsed).toBeLessThan(500);expect(await documentText(page)).toContain('return amount + 1;');
 test.info().annotations.push({type:'typing-time-ms',description:elapsed.toFixed(1)});
});

for(const darkMode of [false,true])test(`visual live assistance ${darkMode?'dark':'light'}`,async({page})=>{
 const text=functionSource+'fn run() {\n'+Array.from({length:35},()=> '    require(true);').join('\n')+'\n    return total(1, 2);\n}\n}\n';
 await mount(page,{text,darkMode});await select(page,text.indexOf('total(1,')+'total(1, '.length);
 await expect(page.locator('.cm-live-signature')).toBeVisible();await expect(page.locator('.cm-live-sticky')).toBeVisible();
 await page.screenshot({path:`test-output/live-editor-${darkMode?'dark':'light'}-signature.png`});
 await expect(page.locator('.cm-live-diagnostic-marker')).toHaveCount(1,{timeout:2500});await page.locator('.cm-live-diagnostic-marker').click();
 await expect(page.locator('.cm-live-diagnostic-popup')).toBeVisible();await page.screenshot({path:`test-output/live-editor-${darkMode?'dark':'light'}-diagnostic.png`});
});

test('rapid Tab after the completion menu opens never indents the line',async({page})=>{
 const text='fn run() { int balance = 1; bal }';await mount(page,{text,completions:[{name:'balanced',kind:'variable'}]});
 await select(page,text.indexOf('bal }')+3);await page.evaluate(()=>window.liveFixture.editor.complete());
 await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();await page.keyboard.press('Tab');
 expect([text,text.replace('bal }','balanced }')]).toContain(await documentText(page));
});

test('record key completion chooses redeemed and accepts it without changing the value',async({page})=>{
 const text='state TicketState { int owner; int serial; int redeemed; }\nactor Ticket owns TicketState {\n entry redeem() {\n TicketState redeemed_ticket = {\n owner: owner,\n serial: serial,\n red\n };\n }\n}';
 await mount(page,{text});const pos=text.indexOf('\n red\n')+5;await select(page,pos);
 await expect(page.locator('.cm-live-ghost')).toHaveText('eemed');
 await page.keyboard.press('Tab');expect(await documentText(page)).toBe(text.replace('\n red\n','\n redeemed\n'));
 await page.keyboard.type(': 1,');expect(await documentText(page)).toContain('redeemed: 1,');
});
