import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const flush=async()=>{for(let n=0;n<8;n++)await new Promise(r=>setImmediate(r));};
test('turning off any-agent mode restores a slow YouTube tab once across repeated polls',async()=>{
 const {outputFiles}=await build({entryPoints:['src/extension/background.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
 const original='https://www.youtube.com/watch?v=test';
 const blocked=`moz-extension://test/blocked.html?url=${encodeURIComponent(original)}`;
 const tab={id:1,url:blocked};const navigations:string[]=[];
 let onMessage:any,request:any,updated:any,removed:any,tick:any;
 let rejectNavigation=false;
 const event=(set:(f:any)=>void=()=>{})=>({addListener:set});
 const browser={
  storage:{local:{get:async()=>({settings:{selected:[],domains:['youtube.com'],anyRunning:true}}),set:async()=>{}}},
  runtime:{getURL:(path:string)=>`moz-extension://test/${path}`,connectNative:()=>{throw new Error('Disconnected');},onMessage:event(f=>onMessage=f)},
  browserAction:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
  tabs:{query:async()=>[{...tab}],update:async(_id:number,change:any)=>{
   navigations.push(change.url);
   if(rejectNavigation){rejectNavigation=false;throw new Error('Navigation failed');}
   // Firefox accepts the request but reports the old URL until it commits.
   return {...tab,status:'loading'};
  },sendMessage:async()=>({protected:true}),onUpdated:event(f=>updated=f),onRemoved:event(f=>removed=f)},
  webRequest:{onBeforeRequest:event(f=>request=f)}
 };
 runInNewContext(outputFiles[0].text,{browser,URL,structuredClone,Date,setTimeout:()=>1,clearTimeout:()=>{},setInterval:(f:any)=>{tick=f;}});
 await flush();assert.equal(navigations.length,0);
 const save=async(anyRunning:boolean)=>{await onMessage({type:'save',settings:{anyRunning}},{url:'moz-extension://test/popup.html'});await flush();};
 await save(false);
 for(let n=0;n<10;n++){tick();await flush();}
 assert.deepEqual(navigations,[original],'polls must not cancel and restart the pending request');
 assert.deepEqual(JSON.parse(JSON.stringify(await request({url:original,type:'main_frame',tabId:1}))),{});
 tab.url=original;updated(1,{url:original});await flush();
 await save(true);
 assert.match((await request({url:original,type:'main_frame',tabId:1})).redirectUrl,/blocked.html/);
 tab.url=blocked;updated(1,{url:blocked});await flush();
 await save(false);assert.equal(navigations.length,2,'a later unblock can restore again');
 removed(1);tick();await flush();assert.equal(navigations.length,3,'tab removal clears pending navigation state');
 updated(1,{status:'complete'});rejectNavigation=true;tick();await flush();
 tick();await flush();assert.equal(navigations.length,5,'a rejected update can be retried');
});

test('the attention page leaves restoration to the background even across repeated polls',async()=>{
 const {outputFiles}=await build({entryPoints:['src/extension/blocked.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
 const dom=new JSDOM('<html><body><div id="agents"></div><p id="reason"></p></body></html>');
 const navigations:string[]=[];let tick:any;
 try{
  runInNewContext(outputFiles[0].text,{
   document:dom.window.document,URL,
   location:{href:'moz-extension://test/blocked.html?url=https%3A%2F%2Fwww.youtube.com%2F',replace:(url:string)=>navigations.push(url)},
   browser:{runtime:{sendMessage:async()=>({settings:{darkMode:false,domains:['youtube.com']},gate:{allowed:true,reason:'No threads are being monitored.',attention:[]}})}},
   setInterval:(f:any)=>{tick=f;}
  });
  await flush();for(let n=0;n<5;n++){tick();await flush();}
  assert.deepEqual(navigations,[],'the page must not race the background navigation');
  assert.equal(dom.window.document.querySelector('#reason')!.textContent,'No threads are being monitored.');
 }finally{dom.window.close();}
});

test('a pending content-script failure cannot re-block a site after settings allow it',async()=>{
 const {outputFiles}=await build({entryPoints:['src/extension/background.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
 let onMessage:any,release:any;const navigations:any[]=[];
 const event=(set:(f:any)=>void=()=>{})=>({addListener:set});
 const tab={id:1,url:'https://www.youtube.com/'};
 const browser={
  storage:{local:{get:async()=>({settings:{selected:[],domains:['youtube.com'],anyRunning:true}}),set:async()=>{}}},
  runtime:{getURL:(path:string)=>`moz-extension://test/${path}`,connectNative:()=>{throw new Error('Disconnected');},onMessage:event(f=>onMessage=f)},
  browserAction:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
  tabs:{query:async()=>[tab],get:()=>new Promise(resolve=>{release=()=>resolve(tab);}),sendMessage:async()=>undefined,
   executeScript:async()=>{throw new Error('Injection refused');},update:async(_id:number,change:any)=>navigations.push(change),onUpdated:event(),onRemoved:event()},
  webRequest:{onBeforeRequest:event()}
 };
 runInNewContext(outputFiles[0].text,{browser,URL,structuredClone,Date,setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1});
 await flush();assert.ok(release);
 await onMessage({type:'save',settings:{anyRunning:false}},{url:'moz-extension://test/popup.html'});
 release();await flush();
 assert.deepEqual(navigations,[],'fallback must check current settings after asynchronous work');
});
