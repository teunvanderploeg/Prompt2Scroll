import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityBounds, filterThreads } from '../src/extension/thread-filters.js';
import { gate, type Session } from '../src/shared/policy.js';
const now=100_000;
const sessions:Session[]=[
  {id:'codex:a',agent:'Codex',name:'Build',task:'Fix login validation',status:'Running',observedAt:now,shortcut:''},
  {id:'t3:b',agent:'T3 Code',name:'Review',task:'Review login tests',status:'Waiting for Input',observedAt:now,shortcut:''},
  {id:'opencode:c',agent:'OpenCode',name:'Build',task:'Fix login tests',status:'Running',observedAt:now-6000,shortcut:''},
];
test('thread search combines words and source; running excludes stale observations',()=>{
  const filter={query:' LOGIN fix ',agent:'Codex',status:'running'};
  assert.deepEqual(filterThreads(sessions,[],filter,now).map(s=>s.id),['codex:a']);
  assert.deepEqual(filterThreads(sessions,[],{query:'',agent:'',status:'running'},now).map(s=>s.id),['codex:a']);
  assert.deepEqual(filterThreads(sessions,[],{query:'',agent:'',status:'attention'},now).map(s=>s.id),['t3:b','opencode:c']);
});
test('filters never deselect hidden threads or allow access past a hidden approval',()=>{
  const selected=['codex:a','t3:b'];
  assert.deepEqual(filterThreads(sessions,selected,{query:'',agent:'Codex',status:'selected'},now).map(s=>s.id),['codex:a']);
  assert.deepEqual(selected,['codex:a','t3:b']);
  const state=gate({selected,domains:['reddit.com']},{sessions,at:now,diagnostics:[]},true,now);
  assert.equal(state.allowed,false);assert.equal(state.attention[0].id,'t3:b');
});
test('uncertain running threads appear under needs attention rather than running',()=>{
 const uncertain={...sessions[0],uncertainReason:'Connection lost'};
 const filters={query:'',agent:'',status:'running'};
 assert.deepEqual(filterThreads([uncertain],[],filters,now),[]);
 assert.deepEqual(filterThreads([uncertain],[],{...filters,status:'attention'},now),[uncertain]);
 assert.equal(gate({selected:[uncertain.id],domains:[]},{at:now,sessions:[uncertain],diagnostics:[]},true,now).allowed,false);
});

test('activity ranges use real activity, not heartbeat freshness; both ends are inclusive',()=>{
  const threads:Session[]=sessions.map((s,i)=>({...s,lastActivityAt:[100,200,300][i],observedAt:now}));
  threads.push({...sessions[0],id:'unknown',observedAt:now});
  const base={query:'',agent:'',status:'all'};
  assert.deepEqual(filterThreads(threads,[],{...base,oldestAt:100,newestAt:200},now).map(s=>s.id),['codex:a','t3:b']);
  assert.deepEqual(filterThreads(threads,[],{...base,oldestAt:250},now).map(s=>s.id),['opencode:c']);
  assert.deepEqual(filterThreads(threads,[],{...base,newestAt:150},now).map(s=>s.id),['codex:a']);
  assert.equal(filterThreads(threads,[],base,now).length,4);
});
test('relative activity windows move with time; custom ranges accept one boundary and reject reversed dates',()=>{
  assert.deepEqual(activityBounds({period:'hour',oldest:'',newest:''},4_000_000),{oldestAt:400000,newestAt:4000000});
  assert.deepEqual(activityBounds({period:'any',oldest:'2026-01-01T12:00',newest:''}),{});
  assert.deepEqual(activityBounds({period:'custom',oldest:'2026-01-01T12:00',newest:''}),{oldestAt:new Date('2026-01-01T12:00').getTime(),newestAt:undefined});
  assert.equal(activityBounds({period:'custom',oldest:'2026-01-02T12:00',newest:'2026-01-01T12:00'}).error,'Oldest activity must be before newest activity.');
  assert.ok(activityBounds({period:'custom',oldest:'invalid',newest:''}).error);
  const end=activityBounds({period:'custom',oldest:'',newest:'2026-01-01T12:00'}).newestAt;
  assert.equal(end,new Date('2026-01-01T12:00').getTime()+59999);
});
