import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle=build({entryPoints:['src/extension/content.ts'],bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'text'}});
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
async function page(){
 const dom=new JSDOM('<!doctype html><html><body><textarea>Draft reply</textarea><video></video></body></html>',{url:'https://reddit.com/r/programming',runScripts:'outside-only'});
 const {window}=dom;const document=window.document;
 let now=100_000;window.Date.now=()=>now;
 let x=0,y=825;Object.defineProperties(window,{scrollX:{get:()=>x},scrollY:{get:()=>y}});
 window.scrollTo=((options:ScrollToOptions)=>{x=options.left??x;y=options.top??y;}) as typeof window.scrollTo;
 document.hasFocus=()=>true;
 const media=document.querySelector('video')!;let paused=false;let played=0;
 media.currentTime=83;
 Object.defineProperties(media,{paused:{get:()=>paused},ended:{get:()=>false}});
 media.pause=()=>{paused=true;};media.play=async()=>{paused=false;played++;media.dispatchEvent(new window.Event('play'));};
 const field=document.querySelector('textarea')!;field.value='My unfinished reply';field.focus();
 const roots:ShadowRoot[]=[];const attach=window.Element.prototype.attachShadow;
 window.Element.prototype.attachShadow=function(options){const root=attach.call(this,options);roots.push(root);return root;};
 const timers=new Map<number,{fn:()=>void;ms:number}>();let timerId=0;
 window.setInterval=((fn:()=>void,ms:number)=>{const id=++timerId;timers.set(id,{fn,ms});return id;}) as typeof window.setInterval;
 window.clearInterval=(id:number|undefined)=>{if(id!==undefined)timers.delete(id);};
 let listener:any;
 const state=(allowed:boolean,blockAt?:number,darkMode=false)=>({settings:{domains:['reddit.com'],darkMode},gate:{allowed,reason:allowed?'All selected agents are running.':'One agent needs attention.',attention:allowed?[]:[{id:'a',agent:'T3 Code',name:'Fix test',task:'Fix test',status:'Waiting for Input',observedAt:now,shortcut:'Fix test'}]},blockAt});
 let current=state(true);
 (window as any).browser={runtime:{onMessage:{addListener:(fn:any)=>listener=fn,removeListener:(fn:any)=>{if(listener===fn)listener=undefined;}},sendMessage:async()=>current}};
 window.eval((await bundle).outputFiles[0].text);await flush();
 return {dom,window,document,media,field,roots,state,reinject:async(next=current,orphan=false)=>{current=next;if(orphan){timers.clear();(window as any).__prompt2scrollContent=true;}window.eval((await bundle).outputFiles[0].text);await flush();},get watchdogs(){return [...timers.values()].filter(t=>t.ms===1000).length;},get played(){return played;},get now(){return now;},send:async(next:ReturnType<typeof state>)=>{current=next;const result=await listener({type:'state',...next});assert.equal(result.protected,true);},advance:(ms:number)=>{now+=ms;for(const {fn,ms:period} of [...timers.values()])if(period===100)fn();},scroll:(left:number,top:number)=>{x=left;y=top;}};
}
test('attention overlay preserves the document, draft, scroll, focus and video position through countdown and resume',async()=>{
 const p=await page();try{
 const {document,window,field,media}=p;const url=window.location.href;const body=document.body;const plays=p.played;
 assert.equal(media.paused,false);assert.equal(body.hasAttribute('inert'),false);
 await p.send(p.state(false,p.now+3000));
 assert.match(p.roots.at(-1)!.textContent!,/Covering this page in 3 seconds/);
 assert.equal(media.paused,false);
 p.advance(1000);assert.match(p.roots.at(-1)!.textContent!,/Covering this page in 2 seconds/);
 p.advance(2000);
 const shield=p.roots.at(-1)!;
 assert.equal(shield.host.isConnected,true);assert.match(shield.textContent!,/Your agent needs attention/);assert.match(shield.textContent!,/Fix test/);
 assert.equal(body.hasAttribute('inert'),true);assert.equal(media.paused,true);assert.equal(media.currentTime,83);
 // Attempts by the website to restart playback remain paused behind the cover.
 await media.play();assert.equal(media.paused,true);
 p.scroll(12,0);
 await p.send(p.state(true));
 assert.equal(shield.host.isConnected,false);assert.equal(document.body,body);assert.equal(document.querySelector('textarea'),field);
 assert.equal(field.value,'My unfinished reply');assert.equal(document.activeElement,field);
 assert.equal(document.querySelector('video'),media);assert.equal(media.currentTime,83);assert.equal(media.paused,false);assert.ok(p.played>plays);
 assert.equal(window.scrollY,825);assert.equal(window.scrollX,0);assert.equal(window.location.href,url);assert.equal(body.hasAttribute('inert'),false);
 }finally{p.dom.window.close();}
});
test('resuming before the deadline cancels the cover, and an uncertain state covers immediately',async()=>{
 const p=await page();try{
 await p.send(p.state(false,p.now+3000));const notice=p.roots.at(-1)!;
 p.advance(1000);await p.send(p.state(true));p.advance(3000);
 assert.equal(notice.host.isConnected,false);assert.equal(p.media.paused,false);assert.equal(p.document.body.hasAttribute('inert'),false);
 await p.send(p.state(false));
 assert.equal(p.document.body.hasAttribute('inert'),true);assert.equal(p.media.paused,true);
 await p.send({...p.state(false),settings:{domains:['youtube.com'],darkMode:false}});
 assert.equal(p.document.body.hasAttribute('inert'),false);assert.equal(p.media.paused,false);
 }finally{p.dom.window.close();}
});


test('extension reinjection disposes old listeners and recovers an orphaned cover without navigating',async()=>{
 const p=await page();try{
  const body=p.document.body;const field=p.field;const media=p.media;
  await p.send(p.state(false));assert.equal(p.watchdogs,1);assert.equal(media.paused,true);
  await p.reinject();assert.equal(p.watchdogs,1);assert.equal(p.document.querySelectorAll('[data-prompt2scroll-overlay="attention"]').length,1);
  // Firefox can terminate the old content context while leaving its DOM intact.
  await p.reinject(p.state(true),true);
  assert.equal(p.watchdogs,1);assert.equal(p.document.querySelector('[data-prompt2scroll-overlay]'),null);
  assert.equal(body.hasAttribute('inert'),false);assert.equal(p.document.body,body);assert.equal(p.document.querySelector('textarea'),field);assert.equal(field.value,'My unfinished reply');
  assert.equal(media.currentTime,83);assert.equal(media.paused,false);
  // Covers from the version before DOM ownership markers also get removed.
  const legacy=p.document.createElement('div');legacy.style.cssText='all:initial;position:fixed;z-index:2147483647;overscroll-behavior:contain;background:#f5f7fc';p.document.documentElement.append(legacy);body.setAttribute('inert','');
  await p.reinject(p.state(true),true);assert.equal(legacy.isConnected,false);assert.equal(body.hasAttribute('inert'),false);
 }finally{p.dom.window.close();}
});


test('countdown and attention overlays follow the saved theme without changing the website theme',async()=>{
 const p=await page();try{
  const original=p.document.documentElement.getAttribute('data-theme');
  await p.send(p.state(false,p.now+3000,true));assert.equal(p.document.querySelector<HTMLElement>('[data-prompt2scroll-overlay="countdown"]')!.dataset.theme,'dark');
  p.advance(3000);const cover=p.document.querySelector<HTMLElement>('[data-prompt2scroll-overlay="attention"]')!;assert.equal(cover.dataset.theme,'dark');
  await p.send(p.state(false,undefined,false));assert.equal(cover.dataset.theme,'light');assert.equal(p.document.documentElement.getAttribute('data-theme'),original);
 }finally{p.dom.window.close();}
});
