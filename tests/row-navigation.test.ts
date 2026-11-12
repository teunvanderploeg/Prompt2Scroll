import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};

test('rows open the app without navigating from the popup, a social site or an unrelated site',async()=>{
 const {outputFiles}=await build({stdin:{contents:"import {SessionRow} from './src/extension/session-row.ts';globalThis.TestRow=SessionRow;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
 for(const page of ['moz-extension://test/popup.html','https://reddit.com/thread','https://calendar.google.com/']){
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:page,runScripts:'outside-only'});
  try{
   const close=dom.window.close.bind(dom.window);let closed=0;dom.window.close=()=>{closed++;};
   const requests:any[]=[];let ok=true;let hold=false;let release:(()=>void)|undefined;
   (dom.window as any).browser={extension:{getViews:()=>page.startsWith('moz-extension:')?[dom.window]:[]},runtime:{sendMessage:async(message:any)=>{requests.push(message);if(hold)await new Promise<void>(resolve=>release=resolve);return {ok};}}};
   dom.window.eval(outputFiles[0].text);
   const changes:any[]=[];const id='22222222-2222-4222-8222-222222222222';const url=`t3code://threads/11111111-1111-4111-8111-111111111111/${id}`;
   const session={id:`t3:${id}`,agent:'T3 Code',name:'T3',task:'Build this',status:'Running',observedAt:Date.now(),shortcut:'Build this',openUrl:url};
   const row=new (dom.window as any).TestRow(session,false,(...args:any[])=>changes.push(args));dom.window.document.body.append(row.element);
   const action=row.element.querySelector('button')!;const checkbox=row.element.querySelector('input')!;
   assert.equal(row.element.querySelector('a'),null);assert.equal(row.element.querySelector('label'),null);assert.equal(action.textContent.includes('Open'),false);
   action.querySelector('.task').click();await flush();action.querySelector('.status').click();await flush();row.element.click();await flush();
   assert.equal(requests.length,3);for(const request of requests)assert.deepEqual(JSON.parse(JSON.stringify(request)),{type:'open-session',id:`t3:${id}`});
   assert.deepEqual(changes,[]);assert.equal(closed,page.startsWith('moz-extension:')?3:0);assert.equal(checkbox.checked,false);assert.equal(dom.window.location.href,page);
   checkbox.click();assert.equal(requests.length,3);assert.deepEqual(changes,[[`t3:${id}`,true]]);
   row.update({...session,status:'Completed'},true);assert.equal(row.element.querySelector('button'),action);assert.equal(row.element.querySelector('input'),checkbox);
   hold=true;action.click();action.click();await flush();assert.equal(requests.length,4);hold=false;release!();await flush();
   ok=false;action.click();await flush();assert.equal(row.element.querySelector('.row-feedback').textContent,'Could not open');assert.equal(dom.window.location.href,page);close();
  }finally{dom.window.close();}
 }
});
