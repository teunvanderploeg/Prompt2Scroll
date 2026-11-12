import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
const flush=async()=>{for(let n=0;n<8;n++)await new Promise(r=>setImmediate(r));};
for(const savedSettings of [undefined,{selected:[],domains:['reddit.com'],anyRunning:false}])test(`nothing watched allows websites from ${savedSettings?'saved settings':'a fresh install'} without any companion`,async()=>{
 const {outputFiles}=await build({entryPoints:['src/extension/background.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
 const original='https://reddit.com/r/test?sort=new#comments';
 const tabs=[{id:1,url:original},{id:2,url:`moz-extension://test/blocked.html?url=${encodeURIComponent(original)}`}];
 let onMessage:any,request:any;const messages:any[]=[];
 const event=(set:(f:any)=>void=()=>{})=>({addListener:set});
 const browser={
  storage:{local:{get:async()=>({settings:savedSettings}),set:async()=>{}}},
  runtime:{getURL:(path:string)=>`moz-extension://test/${path}`,connectNative:()=>{throw new Error('Companion not installed');},onMessage:event(f=>onMessage=f)},
  browserAction:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
  tabs:{query:async()=>tabs.map(tab=>({...tab})),update:async(id:number,changes:any)=>Object.assign(tabs.find(tab=>tab.id===id)!,changes),sendMessage:async(id:number,message:any)=>{messages.push({id,...message});return {protected:true};},onUpdated:event(),onRemoved:event()},
  webRequest:{onBeforeRequest:event(f=>request=f)}
 };
 runInNewContext(outputFiles[0].text,{browser,URL,structuredClone,Date,setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1});
 await flush();
 const assertUnblocked=async()=>{
  const state=await onMessage({type:'get'},{});
  assert.equal(state.connected,false);assert.equal(state.snapshot.sessions.length,0);
  assert.equal(state.settings.selected.length,0);assert.equal(state.settings.anyRunning,false);
  assert.equal(state.gate.allowed,true);
  assert.equal(tabs[1].url,original,'existing block pages return to the website');
  assert.ok(messages.length>0);assert.ok(messages.every(message=>message.gate.allowed),'open website covers are released');
  for(const type of ['main_frame','image','media'])assert.deepEqual(JSON.parse(JSON.stringify(await request({url:original,type,tabId:1}))),{},'new visits and site resources are allowed');
 };
 await assertUnblocked();
 const sender={url:'moz-extension://test/popup.html'};
 await onMessage({type:'save',settings:{anyRunning:true}},sender);await flush();
 assert.equal((await onMessage({type:'get'},{})).gate.allowed,false);
 assert.match((await request({url:original,type:'main_frame',tabId:3})).redirectUrl,/blocked.html/);
 messages.length=0;
 await onMessage({type:'save',settings:{anyRunning:false}},sender);await flush();
 await assertUnblocked();
});
test('settings patches serialize concurrent popup actions and recover after failed writes',async()=>{
 const {outputFiles}=await build({entryPoints:['src/extension/background.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
 let onMessage:any;let release:(()=>void)|undefined;let hold=true,fail=false;const writes:any[]=[];
 const event=(set:(f:any)=>void=()=>{})=>({addListener:set});
 const browser={
  storage:{local:{get:async()=>({settings:{selected:['a','b'],domains:['reddit.com']}}),set:async(value:any)=>{
   if(!value.settings)return;
   writes.push(structuredClone(value.settings));
   if(hold){hold=false;await new Promise<void>(resolve=>{release=resolve;});}
   if(fail){fail=false;throw new Error('Storage unavailable');}
  }}},
  runtime:{getURL:(path:string)=>`moz-extension://test/${path}`,connectNative:()=>({postMessage:()=>{},onMessage:event(),onDisconnect:event()}),onMessage:event(f=>onMessage=f)},
  browserAction:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
  tabs:{query:async()=>[],onUpdated:event(),onRemoved:event()},webRequest:{onBeforeRequest:event()}
 };
 runInNewContext(outputFiles[0].text,{browser,URL,structuredClone,Date,setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1});
 await flush();const sender={url:'moz-extension://test/popup.html'};
 const save=(settings:any)=>onMessage({type:'save',settings},sender);
 const unwatch=save({thread:{id:'a',watched:false}});await flush();
 const appearance=save({darkMode:true});const watch=save({thread:{id:'c',watched:true}});await flush();
 assert.equal(writes.length,1,'later saves wait for the pending storage write');
 release!();await Promise.all([unwatch,appearance,watch]);
 let state=await onMessage({type:'get'},{});
 assert.deepEqual(Array.from(state.settings.selected),['b','c']);assert.equal(state.settings.darkMode,true);
 assert.deepEqual(Array.from(state.settings.domains),['reddit.com']);
 const removing=save({website:{domain:'reddit.com',blocked:false}});
 const adding=save({website:{domain:'youtube.com',blocked:true}});
 await Promise.all([removing,adding]);
 state=await onMessage({type:'get'},{});assert.deepEqual(Array.from(state.settings.domains),['youtube.com']);
 fail=true;await assert.rejects(save({thread:{id:'b',watched:false}}),/Storage unavailable/);
 await assert.rejects(save({countdownSeconds:61}),/0 to 60/);
 state=await save({anyRunning:true});
 assert.deepEqual(Array.from(state.settings.selected),['b','c'],'failed writes do not change the watched list');
 assert.equal(state.settings.anyRunning,true);assert.equal(state.settings.darkMode,true);
});
test('removing watched threads releases covers and restores blocked tabs when no blocker remains',async()=>{
 const {outputFiles}=await build({entryPoints:['src/extension/background.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
 const original='https://reddit.com/r/programming?sort=new#comments';
 const blocked=`moz-extension://test/blocked.html?url=${encodeURIComponent(original)}`;
 const tabs=[{id:1,url:original},{id:2,url:blocked}];
 let receive:any,disconnect:any,onMessage:any,request:any;const messages:any[]=[];
 const event=(set:(f:any)=>void)=>({addListener:set});
 const browser={
  storage:{local:{get:async()=>({settings:{selected:['a','b'],domains:['reddit.com']}}),set:async()=>{}}},
  runtime:{getURL:(path:string)=>`moz-extension://test/${path}`,connectNative:()=>({postMessage:()=>{},onMessage:event(f=>receive=f),onDisconnect:event(f=>disconnect=f)}),onMessage:event(f=>onMessage=f)},
  browserAction:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
  tabs:{query:async()=>tabs.map(tab=>({...tab})),update:async(id:number,changes:any)=>Object.assign(tabs.find(tab=>tab.id===id)!,changes),sendMessage:async(id:number,message:any)=>{messages.push({id,...message});return {protected:true};},onUpdated:event(()=>{}),onRemoved:event(()=>{})},
  webRequest:{onBeforeRequest:event(f=>request=f)}
 };
 runInNewContext(outputFiles[0].text,{browser,URL,structuredClone,Date,setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1});
 await flush();
 const send=(a:string,b:string)=>receive({at:Date.now(),diagnostics:[],sessions:[['a',a],['b',b]].map(([id,status])=>({id,name:id,agent:'Codex',task:id,status,observedAt:Date.now(),shortcut:''}))});
 const save=async(selected:string[],changes:any={})=>{const state=await onMessage({type:'save',settings:{selected,domains:['reddit.com'],...changes}},{url:'moz-extension://test/popup.html'});await flush();return state;};
 send('Completed','Waiting for Input');await flush();
 assert.equal((await save(['a'])).gate.allowed,false,'another watched thread still blocks');
 assert.equal(tabs[1].url,blocked);
 assert.equal(messages.at(-1).gate.allowed,false);
 send('Running','Completed');await flush();
 assert.equal(tabs[1].url,original,'removing the stopped thread lets the remaining running thread unlock');
 tabs[1].url=blocked;send('Completed','Completed');await flush();
 assert.equal(tabs[1].url,blocked);
 disconnect();await flush();
 assert.equal((await save([])).gate.allowed,true,'removing the last watched thread works while disconnected');
 assert.equal(tabs[1].url,original,'the exact original URL is restored');
 assert.equal(messages.at(-1).gate.allowed,true,'existing page covers receive the unblock state');
 assert.deepEqual(JSON.parse(JSON.stringify(await request({url:original,type:'main_frame',tabId:2}))),{},'the restored page is not blocked again');
 assert.equal((await save([], {anyRunning:true})).gate.allowed,false,'any-agent mode still requires a running agent');
});
test('Firefox blocks new visits, covers existing tabs without navigating, warns before covering and blocks host crashes',async()=>{
 const {outputFiles}=await build({entryPoints:['src/extension/background.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
 let request:any,receive:any,disconnect:any,onMessage:any;let tick:any;let stored:any={};let now=100_000;
 const timers=new Map<number,{fn:()=>void;at:number}>();let nextTimer=0;
 const tabs=[{id:1,url:'https://reddit.com/r/programming'}];const messages:any[]=[];const watches:any[]=[];const navigations:any[]=[];
 const event=(set:(f:any)=>void)=>({addListener:set});
 const browser={
  storage:{local:{get:async()=>({settings:{selected:['a','b'],domains:['reddit.com']}}),set:async(x:any)=>{Object.assign(stored,x);}}},
  runtime:{id:'prompt2scroll@local',getURL:(path:string)=>`moz-extension://test/${path}`,connectNative:()=>({postMessage:(message:any)=>watches.push(message),onMessage:event(f=>receive=f),onDisconnect:event(f=>disconnect=f)}),onMessage:event(f=>onMessage=f)},
  browserAction:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
  tabs:{query:async()=>tabs.map(t=>({...t})),update:async(id:number,x:any)=>{navigations.push({id,...x});return Object.assign(tabs.find(t=>t.id===id)!,x);},sendMessage:async(id:number,message:any)=>{messages.push({id,...message});return {protected:true};},onUpdated:event(()=>{}),onRemoved:event(()=>{})},
  webRequest:{onBeforeRequest:event(f=>request=f)}
 };
 runInNewContext(outputFiles[0].text,{browser,URL,structuredClone,Date:{now:()=>now},console,setTimeout:(fn:()=>void,ms:number)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:(id:number)=>timers.delete(id),setInterval:(f:any)=>{tick=f;}});
 const advance=async(ms:number)=>{now+=ms;for(const [id,timer] of timers)if(timer.at<=now){timers.delete(id);timer.fn();}tick();await flush();};
 await flush();assert.equal(tabs[0].url,'https://reddit.com/r/programming');assert.equal(messages.at(-1).gate.allowed,false);
 assert.equal((await onMessage({type:'get'},{})).settings.countdownSeconds,3);assert.equal((await onMessage({type:'get'},{})).settings.anyRunning,false);
 assert.deepEqual(Array.from(watches[0].selected),['a','b']);
 assert.match((await request({url:'https://reddit.com',type:'main_frame',tabId:2})).redirectUrl,/blocked.html/);
 assert.deepEqual(JSON.parse(JSON.stringify(await request({url:'https://old.reddit.com/file',type:'image',tabId:2}))),{cancel:true});
 assert.deepEqual(JSON.parse(JSON.stringify(await request({url:'https://reddit.com/file',type:'image',tabId:1}))),{});
 assert.deepEqual(JSON.parse(JSON.stringify(await request({url:'https://notreddit.com',type:'main_frame',tabId:1}))),{});
 const send=(status='Running',at=now)=>receive({at:now,diagnostics:[],sessions:['a','b'].map(id=>({id,name:id,agent:'Codex',task:'Test',status:id==='b'?status:'Running',observedAt:at,shortcut:''}))});
 send();await flush();assert.equal(tabs[0].url,'https://reddit.com/r/programming');
 send('Waiting for Input');await flush();
 assert.equal(tabs[0].url,'https://reddit.com/r/programming');
 assert.equal(messages.at(-1).blockAt,now+3000);
 // Fresh top-level navigations cannot use the grace period; the open page can finish loading.
 assert.match((await request({url:'https://reddit.com/new',type:'main_frame',tabId:2})).redirectUrl,/blocked.html/);
 assert.deepEqual(JSON.parse(JSON.stringify(await request({url:'https://reddit.com/media',type:'media',tabId:1}))),{});
 assert.deepEqual(JSON.parse(JSON.stringify(await request({url:'https://reddit.com/media',type:'media',tabId:2}))),{cancel:true});
 await advance(1000);send('Completed');await flush();assert.equal(messages.at(-1).blockAt,103_000);
 await advance(1999);assert.equal(tabs[0].url,'https://reddit.com/r/programming');
 await advance(1);assert.equal(tabs[0].url,'https://reddit.com/r/programming');assert.equal(messages.at(-1).gate.allowed,false);assert.equal(messages.at(-1).blockAt,undefined);
 send();await flush();assert.equal(tabs[0].url,'https://reddit.com/r/programming');
 send('Idle');await flush();assert.equal(messages.at(-1).blockAt,now+3000);
 await advance(1000);send();await flush();await advance(2000);assert.equal(tabs[0].url,'https://reddit.com/r/programming');
 send('Error');await flush();disconnect();await flush();
 const offline=await onMessage({type:'get'},{});assert.equal(offline.snapshot.sessions.length,2);assert.equal(offline.snapshot.sessions[0].agent,'Codex');assert.match(offline.snapshot.sessions[0].uncertainReason,/connection/i);assert.equal(offline.gate.attention.length,2);
 assert.equal(tabs[0].url,'https://reddit.com/r/programming');assert.equal(messages.at(-1).gate.allowed,false);assert.equal(messages.at(-1).blockAt,undefined);
 send();await flush();send('Running',now-6000);await flush();assert.equal(tabs[0].url,'https://reddit.com/r/programming');assert.equal(messages.at(-1).gate.allowed,false);assert.equal(messages.at(-1).blockAt,undefined);
 send();await flush();
 const sender={url:'moz-extension://test/popup.html'};
 await onMessage({type:'save',settings:{selected:['a','b'],domains:['reddit.com'],countdownSeconds:5}},sender);
 assert.equal(stored.settings.countdownSeconds,5);
 send('Completed');await flush();assert.equal(messages.at(-1).blockAt,now+5000);
 await advance(4999);assert.equal(tabs[0].url,'https://reddit.com/r/programming');
 await advance(1);assert.equal(tabs[0].url,'https://reddit.com/r/programming');assert.equal(messages.at(-1).gate.allowed,false);assert.equal(messages.at(-1).blockAt,undefined);
 send();await flush();
 await onMessage({type:'save',settings:{selected:['a','b'],domains:['reddit.com'],countdownSeconds:0}},sender);
 send('Idle');await flush();assert.equal(tabs[0].url,'https://reddit.com/r/programming');assert.equal(messages.at(-1).gate.allowed,false);assert.equal(messages.at(-1).blockAt,undefined);
 await assert.rejects(onMessage({type:'save',settings:{selected:['a'],domains:['reddit.com'],countdownSeconds:61}},sender),/0 to 60/);
 assert.equal((await onMessage({type:'get'},{})).settings.countdownSeconds,0);
 await onMessage({type:'save',settings:{selected:['a'],domains:['reddit.com'],darkMode:true}},sender);assert.equal(stored.settings.darkMode,true);
 await assert.rejects(onMessage({type:'save',settings:{selected:['a'],domains:['reddit.com'],darkMode:'yes'}},sender),/on or off/);
 const saved=await onMessage({type:'save',settings:{selected:['a'],domains:['youtube.com']}},{url:'moz-extension://test/popup.html'});assert.deepEqual(Array.from(saved.settings.selected),['a']);assert.equal(stored.settings.domains[0],'youtube.com');assert.equal(saved.settings.countdownSeconds,0);assert.equal(saved.settings.darkMode,true);assert.deepEqual(Array.from(watches.at(-1).selected),['a']);
 assert.equal(navigations.length,0,'state changes never navigate an existing protected tab');
 const denied=await onMessage({type:'save',settings:{selected:[],domains:[]}},{tab:{id:2},url:'https://evil.test'});assert.equal(denied,undefined);
 // Any-agent mode ignores selection and only counts confirmed running sessions.
 const any=await onMessage({type:'save',settings:{selected:[],domains:['reddit.com'],anyRunning:true,countdownSeconds:3}},sender);await flush();
 assert.equal(any.gate.allowed,true);assert.equal(stored.settings.anyRunning,true);
 await assert.rejects(onMessage({type:'save',settings:{selected:[],domains:['reddit.com'],anyRunning:'yes'}},sender),/on or off/);
 const anySend=(a='Completed',b='Running',bAt=now)=>receive({at:now,diagnostics:[],sessions:[{id:'a',name:'A',agent:'Codex',task:'Earlier task',status:a,observedAt:now,shortcut:''},{id:'b',name:'B',agent:'Codex',task:'Working task',status:b,observedAt:bAt,shortcut:''}]});
 anySend();await flush();assert.equal(messages.at(-1).gate.allowed,true);
 anySend('Completed','Completed');await flush();assert.equal(messages.at(-1).gate.allowed,false);assert.equal(messages.at(-1).blockAt,now+3000);assert.equal(messages.at(-1).gate.attention[0].id,'b');
 await advance(1000);anySend();await flush();assert.equal(messages.at(-1).blockAt,undefined);assert.equal(messages.at(-1).gate.allowed,true);
 anySend('Completed','Completed');await flush();await advance(3000);assert.equal(messages.at(-1).blockAt,undefined);assert.equal(messages.at(-1).gate.allowed,false);
 anySend();await flush();anySend('Completed','Running',now-6000);await flush();assert.equal(messages.at(-1).gate.allowed,false);assert.equal(messages.at(-1).blockAt,undefined);
 anySend();await flush();receive({at:now,diagnostics:[],sessions:[]});await flush();assert.equal(messages.at(-1).gate.allowed,false);assert.equal(messages.at(-1).blockAt,undefined);assert.equal(messages.at(-1).gate.attention[0].task,'Working task');
 anySend();await flush();disconnect();await flush();assert.equal(messages.at(-1).gate.allowed,false);assert.equal(messages.at(-1).blockAt,undefined);
 assert.equal(navigations.length,0);
 const keep=await onMessage({type:'save',settings:{selected:[],domains:['reddit.com']}},sender);assert.equal(keep.settings.anyRunning,true);

 // App opening uses the companion, and its response never replaces a heartbeat.
 const threadId='22222222-2222-4222-8222-222222222222';const sessionId=`t3:${threadId}`;
 receive({at:now,diagnostics:[],sessions:[{id:sessionId,agent:'T3 Code',name:'T3',task:'Open me',status:'Running',observedAt:now,shortcut:'Open me',openUrl:`t3code://threads/11111111-1111-4111-8111-111111111111/${threadId}`}]});await flush();
 const opening=onMessage({type:'open-session',id:sessionId},sender);await flush();const openRequest=watches.at(-1);
 assert.equal(openRequest.type,'open-session');assert.equal(openRequest.id,sessionId);assert.equal(openRequest.url,undefined);
 receive({type:'open-result',requestId:openRequest.requestId,ok:true});assert.equal((await opening).ok,true);assert.equal((await onMessage({type:'get'},{})).connected,true);
 const before=watches.length;assert.equal(await onMessage({type:'open-session',id:sessionId},{tab:{id:2},url:'https://evil.test'}),undefined);assert.equal(watches.length,before);
 const fromCover=onMessage({type:'open-session',id:sessionId},{id:'prompt2scroll@local',tab:{id:1,url:'https://reddit.com'},url:'https://reddit.com'});await flush();
 const coverRequest=watches.at(-1);assert.equal(coverRequest.type,'open-session');receive({type:'open-result',requestId:coverRequest.requestId,ok:true});assert.equal((await fromCover).ok,true);
 const interrupted=onMessage({type:'open-session',id:sessionId},sender);await flush();disconnect();assert.equal((await interrupted).ok,false);assert.equal(navigations.length,0);

});

test('auto-open only follows fresh monitored running-to-attention transitions',async()=>{
 const {outputFiles}=await build({entryPoints:['src/extension/background.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
 const threadId='22222222-2222-4222-8222-222222222222';const id=`t3:${threadId}`;
 let receive:any,disconnect:any,onMessage:any;let now=100_000;let stored:any;
 const posts:any[]=[];const event=(set:(f:any)=>void)=>({addListener:set});
 const browser={
  storage:{local:{get:async()=>({settings:{selected:[id],domains:[],autoOpenFinished:true}}),set:async(value:any)=>{stored=value;}}},
  runtime:{getURL:(path:string)=>`moz-extension://test/${path}`,connectNative:()=>({postMessage:(message:any)=>posts.push(message),onMessage:event(f=>receive=f),onDisconnect:event(f=>disconnect=f)}),onMessage:event(f=>onMessage=f)},
  browserAction:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
  tabs:{query:async()=>[],onUpdated:event(()=>{}),onRemoved:event(()=>{})},webRequest:{onBeforeRequest:event(()=>{})}
 };
 runInNewContext(outputFiles[0].text,{browser,URL,structuredClone,Date:{now:()=>now},setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1});
 await flush();
 const session=(status:string,changes:any={})=>({id,agent:'T3 Code',name:'T3',task:'Test',status,observedAt:now,shortcut:'Test',openUrl:`t3code://threads/11111111-1111-4111-8111-111111111111/${threadId}`,...changes});
 const send=async(sessions:any[],at=now)=>{receive({at,sessions,diagnostics:[]});await flush();};
 const opens=()=>posts.filter(message=>message.type==='open-session');
 const sender={url:'moz-extension://test/popup.html'};
 const save=async(changes:any)=>onMessage({type:'save',settings:{selected:[id],domains:[],...changes}},sender);
 await send([session('Completed')]);assert.equal(opens().length,0,'initial discovery does not open old results');
 await send([session('Running')]);await send([session('Completed')]);assert.equal(opens().length,1);assert.equal(opens()[0].id,id);
 receive({type:'open-result',requestId:opens()[0].requestId,ok:false,error:'Unavailable'});
 await send([session('Completed')]);await send([session('Idle')]);assert.equal(opens().length,1,'heartbeats and follow-up idle states never retry');
 await send([session('Running')]);await send([session('Waiting for Input')]);assert.equal(opens().length,2,'a new run rearms auto-open');
 await save({autoOpenFinished:false});assert.equal(stored.settings.autoOpenFinished,false);
 await send([session('Running')]);await send([session('Completed')]);assert.equal(opens().length,2);
 await save({autoOpenFinished:true});assert.equal(stored.settings.autoOpenFinished,true);
 await send([session('Completed')]);assert.equal(opens().length,2,'enabling does not open an already finished thread');
 await send([session('Running')]);await send([session('Completed',{observedAt:now-6000})]);assert.equal(opens().length,2);
 await send([session('Running')]);await send([session('Completed',{uncertainReason:'Unknown status'})]);assert.equal(opens().length,2);
 await send([session('Running')]);now+=6000;await send([session('Completed')]);assert.equal(opens().length,2,'an expired previous heartbeat is not a transition');
 await send([session('Running')]);await send([session('Completed')],now-6000);assert.equal(opens().length,2,'an expired incoming snapshot cannot open');
 await send([session('Running')]);disconnect();await send([session('Completed')]);assert.equal(opens().length,2,'reconnection does not open a thread');
 await send([session('Running')]);await send([]);await send([session('Completed')]);assert.equal(opens().length,2,'disappearing threads do not count as finished');
 await save({selected:[]});await send([session('Running')]);await send([session('Completed')]);assert.equal(opens().length,2,'unselected threads are ignored');
 await save({selected:[],anyRunning:true});await send([session('Running')]);await send([session('Error')]);assert.equal(opens().length,3,'any-agent mode monitors all supported threads');
 await send([session('Running',{openUrl:undefined})]);await send([session('Completed',{openUrl:undefined})]);assert.equal(opens().length,3,'threads without app links are ignored');
 const second=session('Running',{id:'t3:33333333-3333-4333-8333-333333333333',openUrl:'t3code://threads/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333'});
 await send([session('Running'),second]);await send([session('Completed'),{...second,status:'Completed'}]);assert.equal(opens().length,4,'simultaneous completions open one thread');
 await send([session('Completed'),{...second,status:'Completed'}]);assert.equal(opens().length,4);
 const kept=await save({});assert.equal(kept.settings.autoOpenFinished,true);
 await assert.rejects(save({autoOpenFinished:'yes'}),/on or off/);
});
