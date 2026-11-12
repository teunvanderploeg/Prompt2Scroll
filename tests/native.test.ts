import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Decoder,frame } from '../src/companion/framing.js';
test('companion speaks Firefox native framing and exits when Firefox disconnects',async()=>{
 const child=spawn(process.execPath,['--import','tsx','src/companion/host.ts'],{env:{...process.env,P2S_OPENCODE:'/missing/opencode',P2S_T3_DB:'/missing/state.sqlite'}});
 try {
  child.stdin.write(frame({type:'hello'}));
  const snapshot:any=await new Promise((resolve,reject)=>{const d=new Decoder();const timer=setTimeout(()=>reject(new Error('No native heartbeat')),5000);child.stdout.on('data',chunk=>{const messages=d.push(chunk);if(messages.length){clearTimeout(timer);resolve(messages[0]);}});child.on('error',reject);});
  assert.ok(Array.isArray(snapshot.sessions));assert.ok(snapshot.diagnostics.some((s:string)=>s.includes('OpenCode')));assert.ok(snapshot.diagnostics.some((s:string)=>s.includes('T3')));
  const exited=new Promise<number|null>(resolve=>child.once('exit',resolve));child.stdin.end();assert.equal(await exited,0);
 }finally{child.kill();}
});

test('native app-open requests return a framed error for unavailable sessions',async()=>{
 const child=spawn(process.execPath,['--import','tsx','src/companion/host.ts'],{env:{...process.env,P2S_OPENCODE:'/missing/opencode',P2S_T3_DB:'/missing/state.sqlite'}});
 try{
  const reply:any=await new Promise((resolve,reject)=>{
   const decoder=new Decoder();const timer=setTimeout(()=>reject(new Error('No app-open response')),5000);
   child.stdout.on('data',chunk=>{for(const message of decoder.push(chunk)){const value=message as any;if(value.type==='open-result'){clearTimeout(timer);resolve(value);}}});
   child.on('error',reject);child.stdin.write(frame({type:'open-session',id:'not-a-session',requestId:'open:test'}));
  });
  assert.equal(reply.requestId,'open:test');assert.equal(reply.ok,false);assert.match(reply.error,/Could not open/);
  const exited=new Promise<number|null>(resolve=>child.once('exit',resolve));child.stdin.end();assert.equal(await exited,0);
 }finally{child.kill();}
});
