import { writeFile } from 'node:fs/promises';
import { launchBrowser, launchHarness, outputDir as dir } from './launch.mjs';
let browser;
const results=[];
try {
 browser = await launchBrowser();
 for (const [width,height] of [[320,700],[390,844],[768,1024],[1024,768],[1440,900],[844,390]]) {
  let harness, page;
  const requests=[];
  try {
  harness = await launchHarness('vanilla');
  const sim = harness.simulator;
  page = await browser.newPage({viewport:{width,height}});
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
   await page.goto(harness.url);
   await page.getByText('Waiting for approval',{exact:true}).waitFor({timeout:10000});
   const textarea=page.locator('textarea'); if (!await textarea.isDisabled()) throw Error('input not disabled');
   await page.screenshot({path:`${dir}/vanilla-waiting-${width}x${height}.png`});
   const args=page.locator('.ago-background-state__approval pre').first();
   const originalArgs=await args.textContent();
   await args.evaluate(el=>{el.textContent='long argument: '+ 'X'.repeat(600);});
   await page.screenshot({path:`${dir}/vanilla-long-arguments-${width}x${height}.png`});
   let overflow=await page.evaluate(()=>({body:document.documentElement.scrollWidth>document.documentElement.clientWidth,widget:[...document.querySelectorAll('.ago-background-state')].some(el=>el.scrollWidth>el.clientWidth)}));
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
   const csv=await page.request.get(new URL(href,harness.origin).href); if(csv.status()!==200 || (await csv.body()).length!==82) throw Error('download failed');
   await textarea.fill('draft survives resize'); await page.setViewportSize({width:width===320?390:320,height:700});
   if (await textarea.inputValue()!=='draft survives resize') throw Error('draft lost on resize');
   await page.screenshot({path:`${dir}/vanilla-final-${width}x${height}.png`});
   if(width===320) {
     await page.locator('.ago-chat-widget__back').click();
     await page.locator('[data-ago-screen=history]').click();
     await page.screenshot({path:`${dir}/vanilla-history-320.png`});
     await page.locator('.ago-chat-widget__new').click();
     await page.screenshot({path:`${dir}/vanilla-home-320.png`});
   }
   const stop=requests.filter(x=>x.includes('/stop')); if(stop.length) throw Error('unexpected stop');
   results.push({width,height,overflow,downloadBytes:(await csv.body()).length,stopRequests:stop.length,requests});
  } catch (error) { console.log(JSON.stringify({width,height,phase:harness?.simulator.phase,requests,text:page ? await page.locator('body').innerText().catch(() => "") : ""})); if (page) await page.screenshot({path:`${dir}/vanilla-failure-${width}x${height}.png`}).catch(() => {}); throw error; } finally {try { if (page) await page.close(); } finally { if (harness) await harness.close(); }}
 }

 let stream; let onStream; const streaming=new Promise(resolve=>{onStream=resolve;});
 const plugin={name:'ordinary-stream',configureServer(server){server.middlewares.use((req,res,next)=>{
   if(req.method==='POST'&&req.url==='/api/sdk/v1/messages') {
     res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
     res.write('data: {"thread":{"id":"ordinary"},"message_id":"answer","status":"IN_PROGRESS"}\n\n');
     stream=res; onStream(); return;
   }
   next();
 });}};
 let ordinaryHarness, ordinaryPage;
 const ordinaryRequests=[];
 try {
 ordinaryHarness=await launchHarness('vanilla', { plugins:[plugin] });
 ordinaryPage=await browser.newPage({viewport:{width:390,height:844}});
 ordinaryPage.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api')) ordinaryRequests.push(`${r.method()} ${new URL(r.url()).pathname}`);});
   await ordinaryPage.goto(`${ordinaryHarness.url}?ordinary=1`);
   await ordinaryPage.locator('textarea').fill('ordinary question');
   await ordinaryPage.locator('textarea').press('Enter'); await streaming;
   await ordinaryPage.locator('.ago-chat-widget__close').click();
   stream.end('data: {"content":"continued while hidden","thread":{"id":"ordinary"},"status":"DONE"}\n\n');
   await ordinaryPage.locator('.ago-chat-widget-launcher').click();
   await ordinaryPage.getByText('continued while hidden',{exact:false}).waitFor({timeout:5000});
   if(ordinaryRequests.some(request=>request.includes('/stop'))) throw Error('ordinary hide sent stop');
   await ordinaryPage.screenshot({path:`${dir}/vanilla-ordinary-hidden-reopen.png`});
   results.push({ordinaryHidden:true,stopRequests:0,requests:ordinaryRequests});
 } finally {try { if (ordinaryPage) await ordinaryPage.close(); } finally { if (ordinaryHarness) await ordinaryHarness.close(); }}


 let visitorHarness, visitorPage;
 try {
   visitorHarness=await launchHarness('vanilla', { caseName:'history-approval-redacted' });
   visitorPage=await browser.newPage({viewport:{width:390,height:844}});
   await visitorPage.goto(visitorHarness.url);
   await visitorPage.getByText('Waiting for approval',{exact:true}).waitFor({timeout:10000});
   if(await visitorPage.locator('.ago-background-state__approval button').count()) throw Error('visitor saw approval controls');
   if((await visitorPage.locator('body').innerText()).includes('record-42')) throw Error('visitor saw review data');
   await visitorPage.screenshot({path:`${dir}/vanilla-visitor-390.png`});
   results.push({visitorRedacted:true,approvalControls:0});
 } finally {try { if (visitorPage) await visitorPage.close(); } finally { if (visitorHarness) await visitorHarness.close(); }}

} finally {try { if (browser) await browser.close(); } finally { await writeFile(`${dir}/vanilla-results.json`,JSON.stringify(results,null,2)).catch(() => {}); }}
