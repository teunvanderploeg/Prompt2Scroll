import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexState } from '../src/companion/adapters/codex.js';
import { openCodeStatus } from '../src/companion/adapters/opencode.js';
import { t3Status } from '../src/companion/adapters/t3.js';
import { Decoder,frame } from '../src/companion/framing.js';
test('Codex lifecycle, concurrent approvals, user input and completion',()=>{
 const state=new CodexState();const event=(method:string,params:any={},id?:number)=>state.server({method,params:{threadId:'a',...params},...(id===undefined?{}:{id})});
 const status=()=>state.sessions.get('a')!.status;
 event('turn/started');assert.equal(status(),'Running');
 event('item/commandExecution/requestApproval',{},1);event('item/tool/requestUserInput',{},2);assert.equal(status(),'Waiting for Input');
 state.client({id:1,result:{decision:'accept'}});assert.equal(status(),'Waiting for Input');
 state.client({id:2,result:{answers:{}}});assert.equal(status(),'Running');
 event('turn/completed',{turn:{status:'completed'}});assert.equal(status(),'Completed');event('thread/status/changed',{status:{type:'idle'}});assert.equal(status(),'Completed');
 event('turn/started');event('turn/completed',{turn:{status:'failed'}});assert.equal(status(),'Error');
 event('turn/started');event('thread/status/changed',{status:{type:'active',activeFlags:['waitingOnUserInput']}});assert.equal(status(),'Waiting for Input');
});
test('unknown Codex server request blocks, separate threads stay independent',()=>{
 const s=new CodexState();s.server({method:'turn/started',params:{threadId:'a'}});s.server({method:'turn/started',params:{threadId:'b'}});s.server({id:4,method:'future/request',params:{threadId:'a'}});assert.equal(s.sessions.get('a')?.status,'Waiting for Input');assert.equal(s.sessions.get('b')?.status,'Running');
});
test('server-resolved Codex requests release attention only after every request resolves',()=>{
 const state=new CodexState();
 state.server({method:'turn/started',params:{threadId:'a'}});
 for(const id of [1,2])state.server({id,method:'item/tool/requestUserInput',params:{threadId:'a'}});
 state.server({method:'serverRequest/resolved',params:{requestId:1}});
 assert.equal(state.pending.size,1);assert.equal(state.sessions.get('a')!.status,'Waiting for Input');
 state.server({method:'serverRequest/resolved',params:{threadId:'a',requestId:2}});
 assert.equal(state.pending.size,0);assert.equal(state.sessions.get('a')!.status,'Running');
 state.server({method:'turn/completed',params:{threadId:'a',turn:{status:'completed'}}});
 state.client({id:2,result:{}});state.server({method:'serverRequest/resolved',params:{requestId:2}});
 assert.equal(state.sessions.get('a')!.status,'Completed','late duplicate replies cannot restart a finished turn');
});
test('Codex active status discovers resumed work before approvals and preserves later idle status',()=>{
 for(const serverResolved of [false,true]){
  const state=new CodexState();
  state.server({method:'thread/status/changed',params:{threadId:'a',status:{type:'active',activeFlags:[]}}});
  state.server({id:1,method:'item/commandExecution/requestApproval',params:{threadId:'a'}});
  if(serverResolved)state.server({method:'serverRequest/resolved',params:{requestId:1}});
  else state.client({id:1,result:{decision:'accept'}});
  assert.equal(state.sessions.get('a')!.status,'Running');
  state.server({id:2,method:'item/tool/requestUserInput',params:{threadId:'a'}});
  state.server({method:'thread/status/changed',params:{threadId:'a',status:{type:'idle'}}});
  state.client({id:2,result:{}});
  assert.equal(state.sessions.get('a')!.status,'Idle');
 }
});
test('OpenCode waits on pending requests even while running; retries and unknown states block',()=>{
 assert.equal(openCodeStatus({type:'running'},false),'Running');assert.equal(openCodeStatus({type:'running'},true),'Waiting for Input');assert.equal(openCodeStatus({type:'retry'},false),'Idle');assert.equal(openCodeStatus({type:'future'},false),'Idle');assert.equal(openCodeStatus(undefined,false,'failed'),'Error');assert.equal(openCodeStatus(undefined,false,'succeeded'),'Completed');
});
test('T3 pending input overrides saved running flags; unknown state is idle',()=>{assert.equal(t3Status('running',1),'Waiting for Input');assert.equal(t3Status('running',0),'Running');assert.equal(t3Status('future',0),'Idle');assert.equal(t3Status('failed',0),'Error');});
test('native framing handles split and coalesced messages; rejects oversized payloads',()=>{
 const d=new Decoder();const b=frame({hello:'agent'});assert.deepEqual(d.push(b.subarray(0,2)),[]);assert.deepEqual(d.push(b.subarray(2,8)),[]);assert.deepEqual(d.push(Buffer.concat([b.subarray(8),frame({n:2})])),[{hello:'agent'},{n:2}]);const huge=Buffer.alloc(4);huge.writeUInt32LE(2**30);assert.throws(()=>d.push(huge));
});

test('Codex keeps activity time separate from heartbeat observations',()=>{
 const state=new CodexState();state.server({method:'turn/started',params:{threadId:'a'}});
 const s=state.sessions.get('a')!;assert.ok(typeof s.lastActivityAt==='number');
 const activity=s.lastActivityAt;const observed=s.observedAt;
 state.server({method:'server/heartbeat',params:{}});
 assert.equal(s.lastActivityAt,activity);assert.equal(s.observedAt,observed);
});
