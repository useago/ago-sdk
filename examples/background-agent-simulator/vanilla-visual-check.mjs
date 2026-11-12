import { createServer } from 'vite';
import { createSimulator } from './server.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = process.env.AGO_SCREENSHOT_DIR || '.context/s5-screenshots'; await mkdir(dir, {recursive:true});
const optimizeDeps = {entries:['examples/background-agent-simulator/vanilla.html']};
const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
const results=[];
try {
 for (const [width,height] of [[320,700],[390,844],[768,1024],[1024,768],[1440,900],[844,390]]) {
  const sim=createSimulator(); const backend=await sim.start();
  const vite=await createServer({configFile:false,optimizeDeps,server:{host:'127.0.0.1',port:0,strictPort:false,proxy:{'/api':backend,'/fixture-files':backend}}}); await vite.listen();
  const port=vite.httpServer.address().port; const page=await browser.newPage({viewport:{width,height}}); const requests=[];
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  try {
   await page.goto(`http://localhost:${port}/examples/background-agent-simulator/vanilla.html`);
   await page.getByText('Waiting for approval',{exact:true}).waitFor({timeout:10000});
   const textarea=page.locator('textarea'); if (!await textarea.isDisabled()) throw Error('input not disabled');
   await page.screenshot({path:`${dir}/waiting-${width}x${height}.png`});
   const args=page.locator('.ago-response-state__approval pre').first();
   const originalArgs=await args.textContent();
   await args.evaluate(el=>{el.textContent='long argument: '+ 'X'.repeat(600);});
   await page.screenshot({path:`${dir}/long-arguments-${width}x${height}.png`});
   let overflow=await page.evaluate(()=>({body:document.documentElement.scrollWidth>document.documentElement.clientWidth,widget:[...document.querySelectorAll('.ago-response-state')].some(el=>el.scrollWidth>el.clientWidth)}));
   if (overflow.body||overflow.widget) throw Error(`overflow ${JSON.stringify(overflow)}`);
   await args.evaluate((el,text)=>{el.textContent=text;}, originalArgs);
   if(width===320) {
     const before=requests.length;
     await page.locator('.ago-chat-widget__close').click();
     await page.waitForTimeout(2200);
     if(requests.length!==before) throw Error('inactive background made API requests');
     await page.locator('.ago-chat-widget-launcher').click();
     await page.getByText('Waiting for approval',{exact:true}).waitFor({timeout:10000});
   }
   await page.getByRole('button',{name:'Approve',exact:true}).click();
   await page.getByText('background-report.csv',{exact:true}).waitFor({timeout:10000});
   const href=await page.getByText('background-report.csv',{exact:true}).locator('xpath=ancestor::a').getAttribute('href');
   const csv=await page.request.get(new URL(href,`http://localhost:${port}`).href); if(csv.status()!==200 || (await csv.body()).length!==82) throw Error('download failed');
   await textarea.fill('draft survives resize'); await page.setViewportSize({width:width===320?390:320,height:700});
   if (await textarea.inputValue()!=='draft survives resize') throw Error('draft lost on resize');
   await page.screenshot({path:`${dir}/final-${width}x${height}.png`});
   if(width===320) {
     await page.locator('.ago-chat-widget__back').click();
     await page.locator('[data-ago-screen=history]').click();
     await page.screenshot({path:`${dir}/history-320.png`});
     await page.locator('.ago-chat-widget__new').click();
     await page.screenshot({path:`${dir}/home-320.png`});
   }
   const stop=requests.filter(x=>x.includes('/stop')); if(stop.length) throw Error('unexpected stop');
   results.push({width,height,overflow,downloadBytes:(await csv.body()).length,stopRequests:stop.length,requests});
  } catch (error) { console.log(JSON.stringify({width,height,phase:sim.phase,requests,text:await page.locator('body').innerText()})); await page.screenshot({path:`${dir}/failure-${width}x${height}.png`}); throw error; } finally {await page.close();await vite.close();await sim.close();}
 }

 const ordinarySim=createSimulator(); const ordinaryBackend=await ordinarySim.start();
 let stream; let onStream; const streaming=new Promise(resolve=>{onStream=resolve;});
 const plugin={name:'ordinary-stream',configureServer(server){server.middlewares.use((req,res,next)=>{
   if(req.method==='POST'&&req.url==='/api/sdk/v1/messages') {
     res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
     res.write('data: {"thread":{"id":"ordinary"},"message_id":"answer","status":"IN_PROGRESS"}\n\n');
     stream=res; onStream(); return;
   }
   next();
 });}};
 const ordinaryVite=await createServer({configFile:false,optimizeDeps,plugins:[plugin],server:{host:'127.0.0.1',port:0,proxy:{'/api':ordinaryBackend}}}); await ordinaryVite.listen();
 const ordinaryPort=ordinaryVite.httpServer.address().port; const ordinaryPage=await browser.newPage({viewport:{width:390,height:844}}); const ordinaryRequests=[];
 ordinaryPage.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api')) ordinaryRequests.push(`${r.method()} ${new URL(r.url()).pathname}`);});
 try {
   await ordinaryPage.goto(`http://localhost:${ordinaryPort}/examples/background-agent-simulator/vanilla.html?ordinary=1`);
   await ordinaryPage.locator('textarea').fill('ordinary question');
   await ordinaryPage.locator('textarea').press('Enter'); await streaming;
   await ordinaryPage.locator('.ago-chat-widget__close').click();
   stream.end('data: {"content":"continued while hidden","thread":{"id":"ordinary"},"status":"DONE"}\n\n');
   await ordinaryPage.locator('.ago-chat-widget-launcher').click();
   await ordinaryPage.getByText('continued while hidden',{exact:false}).waitFor({timeout:5000});
   if(ordinaryRequests.some(request=>request.includes('/stop'))) throw Error('ordinary hide sent stop');
   await ordinaryPage.screenshot({path:`${dir}/ordinary-hidden-reopen.png`});
   results.push({ordinaryHidden:true,stopRequests:0,requests:ordinaryRequests});
 } finally {await ordinaryPage.close();await ordinaryVite.close();await ordinarySim.close();}


 const visitorSim=createSimulator({caseName:'history-approval-redacted'}); const visitorBackend=await visitorSim.start();
 const visitorVite=await createServer({configFile:false,optimizeDeps,server:{host:'127.0.0.1',port:0,proxy:{'/api':visitorBackend}}}); await visitorVite.listen();
 const visitorPort=visitorVite.httpServer.address().port; const visitorPage=await browser.newPage({viewport:{width:390,height:844}});
 try {
   await visitorPage.goto(`http://localhost:${visitorPort}/examples/background-agent-simulator/vanilla.html`);
   await visitorPage.getByText('Waiting for approval',{exact:true}).waitFor({timeout:10000});
   if(await visitorPage.locator('.ago-response-state__approval button').count()) throw Error('visitor saw approval controls');
   if((await visitorPage.locator('body').innerText()).includes('record-42')) throw Error('visitor saw review data');
   await visitorPage.screenshot({path:`${dir}/visitor-390.png`});
   results.push({visitorRedacted:true,approvalControls:0});
 } finally {await visitorPage.close();await visitorVite.close();await visitorSim.close();}

} finally {await browser.close(); await writeFile(`${dir}/results.json`,JSON.stringify(results,null,2));}
