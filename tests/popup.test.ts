import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { DEFAULTS } from '../src/shared/policy.js';
import { updateSettings } from '../src/shared/settings.js';

const flush=async()=>{for(let n=0;n<6;n++)await new Promise(resolve=>setImmediate(resolve));};
test('an outdated popup sends only its action and cannot restore removed threads or websites',async()=>{
 const {outputFiles}=await build({entryPoints:['src/extension/popup.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
 const html=await readFile('src/extension/popup.html','utf8');
 let settings={...structuredClone(DEFAULTS),selected:['t3:a'],domains:['reddit.com']};const writes:any[]=[];
 async function open(){
  const dom=new JSDOM(html,{url:'https://extension.test/popup.html',runScripts:'outside-only'});
  dom.window.structuredClone=structuredClone;dom.window.setInterval=(()=>1) as typeof dom.window.setInterval;
  (dom.window as any).browser={storage:{local:{get:async()=>({}),set:async()=>{}}},runtime:{sendMessage:async(message:any)=>{
   if(message.type==='save'){writes.push(structuredClone(message.settings));settings=updateSettings(settings,message.settings);}
   return {settings:structuredClone(settings),connected:true,snapshot:{sessions:[],diagnostics:[]}};
  }}};
  dom.window.eval(outputFiles[0].text);await flush();return dom;
 }
 const a=await open(),b=await open();
 try{
  a.window.document.querySelector<HTMLInputElement>('#monitored-sessions input')!.click();await flush();
  assert.deepEqual(settings.selected,[]);
  b.window.document.querySelector<HTMLInputElement>('#dark-mode')!.click();await flush();
  assert.deepEqual(settings.selected,[]);assert.equal(settings.darkMode,true);
  assert.deepEqual(writes[1],{darkMode:true});
  a.window.document.querySelector<HTMLButtonElement>('[aria-label="Remove reddit.com"]')!.click();await flush();
  assert.deepEqual(settings.domains,[]);
  const field=b.window.document.querySelector<HTMLInputElement>('#domain-input')!;field.value='youtube.com';
  b.window.document.querySelector('#sites')!.dispatchEvent(new b.window.Event('submit',{cancelable:true}));await flush();
  assert.deepEqual(settings.domains,['youtube.com']);assert.deepEqual(settings.selected,[]);
 }finally{a.window.close();b.window.close();}
});
test('countdown feedback expires, valid edits save in order, and dark mode persists with failure recovery',async()=>{
 const {outputFiles}=await build({entryPoints:['src/extension/popup.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
 const html=await readFile('src/extension/popup.html','utf8');
 let settings={...structuredClone(DEFAULTS),selected:['t3:test'],domains:['reddit.com']};
 let fail=false,hold=false;const writes:number[]=[];const releases:(()=>void)[]=[];
 async function open(){
  const dom=new JSDOM(html,{url:'https://extension.test/popup.html',runScripts:'outside-only'});
  dom.window.structuredClone=structuredClone;
  dom.window.setInterval=(()=>1) as typeof dom.window.setInterval;
  let now=0,next=0;const timers=new Map<number,{fn:()=>void;at:number}>();
  dom.window.setTimeout=((fn:()=>void,ms=0)=>{const id=++next;timers.set(id,{fn,at:now+ms});return id;}) as typeof dom.window.setTimeout;
  dom.window.clearTimeout=id=>{if(id!==undefined)timers.delete(id);};
  const advance=(ms:number)=>{now+=ms;for(const [id,timer] of timers)if(timer.at<=now){timers.delete(id);timer.fn();}};
  (dom.window as any).browser={storage:{local:{get:async()=>({}),set:async()=>{}}},runtime:{sendMessage:async(message:any)=>{
   if(message.type==='get')return {settings:structuredClone(settings),connected:true,snapshot:{sessions:[],diagnostics:[]}};
   writes.push(message.settings.countdownSeconds);
   if(hold)await new Promise<void>(resolve=>releases.push(resolve));
   if(fail)throw new Error('Storage unavailable');
   settings=updateSettings(settings,structuredClone(message.settings));
   return {settings};
  }}};
  dom.window.eval(outputFiles[0].text);await flush();
  const seconds=dom.window.document.querySelector<HTMLInputElement>('#countdown-seconds')!;
  const edit=(value:string)=>{seconds.value=value;seconds.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  return {dom,seconds,edit,advance,dark:dom.window.document.querySelector<HTMLInputElement>('#dark-mode')!,any:dom.window.document.querySelector<HTMLInputElement>('#any-running')!,autoOpen:dom.window.document.querySelector<HTMLInputElement>('#auto-open-finished')!,status:dom.window.document.querySelector('#settings-saved')!};
 }
 const p=await open();try{
  assert.equal(p.dom.window.document.querySelector('#preferences button'),null);
  p.edit('8');await flush();assert.equal(settings.countdownSeconds,8);assert.equal(p.status.textContent,'Saved');p.advance(1999);assert.equal(p.status.textContent,'Saved');p.advance(1);assert.equal(p.status.textContent,'');
  const count=writes.length;
  for(const value of ['', '61', '-1', '1.5']){p.edit(value);await flush();}
  assert.equal(writes.length,count);assert.equal(settings.countdownSeconds,8);assert.match(p.status.textContent!,/whole number/);
  hold=true;p.edit('1');await flush();p.edit('12');await flush();
  assert.equal(writes.at(-1),1,'the second write waits for the first');
  hold=false;releases.shift()!();await flush();
  assert.equal(settings.countdownSeconds,12);assert.deepEqual(writes.slice(-2),[1,12]);assert.equal(p.seconds.value,'12');assert.equal(p.status.textContent,'Saved');
  assert.deepEqual(settings.selected,['t3:test']);assert.deepEqual(settings.domains,['reddit.com']);
  fail=true;p.edit('5');await flush();assert.equal(settings.countdownSeconds,12);assert.match(p.status.textContent!,/Could not save/);p.advance(3000);assert.match(p.status.textContent!,/Could not save/);
  fail=false;p.edit('0');await flush();assert.equal(settings.countdownSeconds,0);assert.equal(p.status.textContent,'Saved');
  assert.equal(p.autoOpen.checked,false);p.autoOpen.click();await flush();assert.equal(settings.autoOpenFinished,true);
  fail=true;p.autoOpen.click();await flush();assert.equal(settings.autoOpenFinished,true);assert.equal(p.autoOpen.checked,true);fail=false;
  p.dark.click();await flush();assert.equal(settings.darkMode,true);assert.equal(p.dom.window.document.documentElement.dataset.theme,'dark');
  fail=true;p.dark.click();await flush();assert.equal(settings.darkMode,true);assert.equal(p.dark.checked,true);assert.equal(p.dom.window.document.documentElement.dataset.theme,'dark');
  fail=false;p.any.click();await flush();assert.equal(settings.anyRunning,true);assert.equal(p.dom.window.document.querySelector<HTMLElement>('#monitor-mode')!.hidden,false);assert.equal(p.dom.window.document.querySelector('#monitored-label')!.textContent,'Saved selection');assert.match(p.dom.window.document.querySelector('.session input')!.getAttribute('aria-label')!,/^Saved selection /);assert.equal(p.dom.window.document.querySelector<HTMLInputElement>('.session input')!.disabled,true);
 }finally{p.dom.window.close();}
 const reopened=await open();try{assert.equal(reopened.seconds.value,'0');assert.equal(reopened.dark.checked,true);assert.equal(reopened.any.checked,true);assert.equal(reopened.autoOpen.checked,true);assert.equal(reopened.dom.window.document.documentElement.dataset.theme,'dark');}finally{reopened.dom.window.close();}
});
