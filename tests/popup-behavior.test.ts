import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { DEFAULTS, type Session } from '../src/shared/policy.js';
const bundle=build({entryPoints:['src/extension/popup.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
const flush=async()=>{for(let n=0;n<6;n++)await new Promise(resolve=>setImmediate(resolve));};
test('pinned threads survive filters, status updates keep row focus, websites autosave, and popup position persists',async()=>{
 const html=await readFile('src/extension/popup.html','utf8');
 let settings={...structuredClone(DEFAULTS),selected:['t3:a']};const storage:Record<string,any>={};let fail=false;const copied:string[]=[];
 let sessions:Session[]=[{id:'t3:a',agent:'T3 Code',name:'T3',task:'Selected old task',status:'Running',observedAt:Date.now(),lastActivityAt:1,shortcut:'Selected old task'},...Array.from({length:20},(_,i):Session=>({id:`codex:${i}`,agent:'Codex',name:'Codex',task:`Build task ${i}`,status:'Running',observedAt:Date.now(),lastActivityAt:20-i,shortcut:`codex resume ${i}`}))];
 async function open(){
  const dom=new JSDOM(html,{url:'https://extension.test/popup.html',runScripts:'outside-only'});const {window}=dom;let tick:any;
  Object.defineProperty(window.navigator,'clipboard',{value:{writeText:async(text:string)=>{copied.push(text);}}});
  window.structuredClone=structuredClone;window.setInterval=((fn:any)=>{tick=fn;return 1;}) as typeof window.setInterval;
  (window as any).browser={storage:{local:{get:async()=>structuredClone(storage),set:async(value:any)=>Object.assign(storage,structuredClone(value))}},runtime:{sendMessage:async(message:any)=>{
   if(message.type==='get')return {settings:structuredClone(settings),connected:true,snapshot:{sessions:structuredClone(sessions),diagnostics:[]}};
   if(fail)throw new Error('Cannot save');settings=structuredClone(message.settings);return {settings};
  }}};
  window.eval((await bundle).outputFiles[0].text);await flush();
  return {dom,window,document:window.document,tick:async()=>{tick();await flush();}};
 }
 const p=await open();try{
  const {document,window}=p;const search=document.querySelector<HTMLInputElement>('#thread-search')!;
  search.value='nothing matches';search.dispatchEvent(new window.Event('input'));await flush();
  assert.equal(document.querySelectorAll('#sessions .session').length,0);assert.match(document.querySelector('#monitored-sessions')!.textContent!,/Selected old task/);
  const source=document.querySelector<HTMLSelectElement>('#agent-filter')!;source.value='Codex';source.dispatchEvent(new window.Event('change'));
  assert.equal(document.querySelectorAll('#monitored-sessions .session').length,1);
  search.value='';search.dispatchEvent(new window.Event('input'));
  const list=document.querySelector<HTMLElement>('#sessions')!;const item=list.firstElementChild!;const input=item.querySelector<HTMLInputElement>('input')!;input.focus();list.scrollTop=90;
  sessions=sessions.map(s=>({...s,observedAt:Date.now(),status:s.id==='codex:0'?'Waiting for Input':s.status}));await p.tick();
  assert.equal(list.firstElementChild,item);assert.equal(document.activeElement,input);assert.equal(list.scrollTop,90);assert.match(item.textContent!,/Needs input/);
  const copy=item.querySelector<HTMLButtonElement>('button.session-main')!;copy.click();await flush();assert.equal(item.querySelector('.row-feedback')!.textContent,'Copied');await p.tick();assert.equal(item.querySelector('.row-feedback')!.textContent,'Copied');assert.deepEqual(copied,['codex resume 0']);assert.equal(input.checked,false);
  input.click();await flush();assert.ok(settings.selected.includes('codex:0'));assert.equal(document.querySelector('#monitored-sessions [data-id="codex:0"]'),item);assert.equal(item.querySelector('input'),input);
  input.click();await flush();assert.ok(!settings.selected.includes('codex:0'));assert.equal(list.firstElementChild,item);
  list.dispatchEvent(new window.Event('scroll'));await flush();assert.equal(storage.popupView.scroll,90);
  document.querySelector<HTMLButtonElement>('#websites-tab')!.click();await flush();assert.equal(storage.popupView.page,'websites');
  const field=document.querySelector<HTMLInputElement>('#domain-input')!;field.value='https://example.com/';document.querySelector('#sites')!.dispatchEvent(new window.Event('submit',{cancelable:true}));await flush();
  assert.ok(settings.domains.includes('example.com'));assert.equal(field.value,'');assert.ok(document.querySelector('[aria-label="Remove example.com"]'));
  field.value='example.com';document.querySelector('#sites')!.dispatchEvent(new window.Event('submit',{cancelable:true}));await flush();assert.equal(settings.domains.filter(d=>d==='example.com').length,1);assert.equal(document.querySelector('#site-error')!.textContent,'Already added.');
  field.value='bad host';document.querySelector('#sites')!.dispatchEvent(new window.Event('submit',{cancelable:true}));await flush();assert.ok(!settings.domains.includes('bad host'));
  fail=true;document.querySelector<HTMLButtonElement>('[aria-label="Remove example.com"]')!.click();await flush();assert.ok(settings.domains.includes('example.com'));assert.ok(document.querySelector('[aria-label="Remove example.com"]'));
  fail=false;document.querySelector<HTMLButtonElement>('[aria-label="Remove example.com"]')!.click();await flush();assert.ok(!settings.domains.includes('example.com'));assert.equal(document.querySelector('[aria-label="Remove example.com"]'),null);
  assert.equal(settings.selected[0],'t3:a');assert.equal(settings.countdownSeconds,3);
  const selectedBefore=[...settings.selected];const mode=document.querySelector<HTMLInputElement>('#any-running')!;
  mode.click();await flush();assert.equal(settings.anyRunning,true);assert.equal(document.querySelector('#monitored-label')!.textContent,'Saved selection');
  const checks=[...document.querySelectorAll<HTMLInputElement>('.session input[type=checkbox]')];assert.ok(checks.length>1);assert.ok(checks.every(input=>input.disabled));
  checks[0].click();checks[1].dispatchEvent(new window.Event('change'));await flush();assert.deepEqual(settings.selected,selectedBefore);
  await p.tick();assert.ok(checks.every(input=>input.disabled));assert.equal(mode.disabled,false);assert.equal(document.querySelector<HTMLInputElement>('#dark-mode')!.disabled,false);
  const action=document.querySelector<HTMLButtonElement>('#sessions .session-main')!;assert.equal(action.disabled,false);action.click();await flush();assert.equal(copied.at(-1),'codex resume 0');
  mode.click();await flush();assert.equal(settings.anyRunning,false);assert.ok(checks.every(input=>!input.disabled));assert.deepEqual(settings.selected,selectedBefore);

 }finally{p.dom.window.close();}
 const reopened=await open();try{
  assert.equal(reopened.document.querySelector('#websites-panel')!.hasAttribute('hidden'),false);
  reopened.document.querySelector<HTMLButtonElement>('#threads-tab')!.click();assert.equal(reopened.document.querySelector('#sessions')!.scrollTop,90);
 }finally{reopened.dom.window.close();}
});
