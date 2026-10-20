import { chromium } from 'file:///F:/Projects/Zeaplay-V2/node_modules/@playwright/test/index.mjs';
const browser = await chromium.launch({channel:'chrome', headless:true});
const rows=[];
try {
 const page=await browser.newPage();
 await page.route('**/*',route=>new URL(route.request().url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)?route.continue():route.abort());
 page.on('request',async request=>{
  if(request.method()==='POST' && request.url().includes('/auth/')){
   const h=await request.allHeaders();rows.push({url:request.url(),origin:h.origin ?? null,intent:h['x-zea-browser']??null,site:h['sec-fetch-site']??null});
  }
 });
 await page.goto('http://localhost:6300/',{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(async()=>{
  const xhr=await new Promise(resolve=>{const x=new XMLHttpRequest();x.open('POST','/api/auth/browser-session/refresh');x.setRequestHeader('X-Zea-Browser','1');x.setRequestHeader('Content-Type','application/json');x.onload=()=>resolve({status:x.status,detail:JSON.parse(x.responseText).detail});x.send('{}')});
  const r=await fetch('/api/auth/browser-session/refresh',{method:'POST',headers:{'X-Zea-Browser':'1','Content-Type':'application/json'},body:'{}'});
  return {page:location.origin,policy:document.querySelector('meta[name=referrer]')?.content,xhr,fetch:{status:r.status,detail:(await r.json()).detail}};
 });
 console.log(JSON.stringify({result,requests:rows},null,2));
} finally {await browser.close()}

