import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
test.use({browserName:process.env.ARGENT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.ARGENT_BROWSER==='webkit'?undefined:'msedge'});
let server,url;
test.beforeAll(async()=>{server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<html><body></body></html>');}else{res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../frontend/'+req.url.slice(1),import.meta.url)));}}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;});
test.afterAll(()=>server.close());
async function open(page,settings){await page.goto(url);await page.evaluate(async settings=>{const {showSettings}=await import('/settings.js');window.saved=null;window.calls=[];await showSettings({getSettings:()=>settings,setSettings:async value=>window.saved=value,invoke:async(n,a)=>window.calls.push({n,a})});},settings);await page.getByRole('tab',{name:'AI',exact:true}).click();}
test('default team and Sol settings are explicit, saving disabled team persists consent choice without API calls',async({page})=>{
 await open(page,{language:'en',aiEnabled:false});
 const team=page.getByLabel('AI team: three workers and supervisor');await expect(team).toBeChecked();
 await expect(page.getByLabel('Model ID')).toHaveValue('gpt-6.1-sol');
 await expect(page.getByText(/Agents need your permission to access project code/)).toBeVisible();
 await team.uncheck();await page.getByRole('button',{name:'Save',exact:true}).click();
 const saved=await page.evaluate(()=>window.saved);expect(saved.aiTeamEnabled).toBe(false);expect(saved.aiEnabled).toBe(false);expect(saved.model).toBe('gpt-6.1-sol');
 expect(await page.evaluate(()=>window.calls.length)).toBe(0);
});
test('saved model and disabled team survive settings round trip',async({page})=>{
 await open(page,{language:'en',model:'fixture-model',aiEnabled:true,aiTeamEnabled:false,reasoningEffort:'high',maxRequests:3,maxOutputTokens:4096});
 await expect(page.getByLabel('AI team: three workers and supervisor')).not.toBeChecked();await expect(page.getByLabel('Model ID')).toHaveValue('fixture-model');
 await page.getByRole('button',{name:'Save',exact:true}).click();const saved=await page.evaluate(()=>window.saved);
 expect(saved.model).toBe('fixture-model');expect(saved.aiTeamEnabled).toBe(false);expect(saved.reasoningEffort).toBe('high');expect(saved.maxRequests).toBe(3);expect(saved.maxOutputTokens).toBe(4096);
 expect(await page.evaluate(()=>window.calls.length)).toBe(0);
});