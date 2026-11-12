import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { T3Adapter } from '../src/companion/adapters/t3.js';
import { ownsDatabaseAndPort, validRuntime } from '../src/companion/adapters/t3-live.js';
import { fresh, gate } from '../src/shared/policy.js';

test('quiet T3 work stays running; approval, completion, server loss and restart block',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'p2s-t3-'));const path=join(dir,'statev2.sqlite');
  const db=new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT,title TEXT,active_provider_thread_id TEXT,deleted_at TEXT,archived_at TEXT,updated_at TEXT);
      CREATE TABLE orchestration_v2_projection_provider_turns(provider_turn_id TEXT,provider_thread_id TEXT,ordinal INTEGER,status TEXT);
      CREATE TABLE orchestration_v2_projection_runs(run_id TEXT,thread_id TEXT,ordinal INTEGER,status TEXT);
      CREATE TABLE orchestration_v2_projection_runtime_requests(thread_id TEXT,status TEXT);
      CREATE TABLE orchestration_v2_projection_provider_threads(thread_id TEXT,status TEXT,updated_at TEXT);
      INSERT INTO orchestration_v2_projection_threads VALUES('quiet','Long coding task','provider-quiet',NULL,NULL,'2026-01-01T01:00:00Z');
      INSERT INTO orchestration_v2_projection_runs VALUES('run','quiet',1,'running');
      INSERT INTO orchestration_v2_projection_provider_threads VALUES('quiet','active','2026-01-01T01:00:00Z');`);
    let startedAt=Date.parse('2026-01-01T00:00:00Z');let alive=true;
    const adapter=new T3Adapter(path,async()=>{if(!alive)throw new Error('Server disconnected');return {startedAt};});
    const allowed=(sessions:Awaited<ReturnType<typeof adapter.poll>>)=>gate({selected:['t3:quiet'],domains:['reddit.com']},{sessions,at:Date.now(),diagnostics:[]},true).allowed;
    let sessions=await adapter.poll();assert.equal(sessions[0].status,'Running');assert.ok(fresh(sessions[0].observedAt));assert.equal(sessions[0].lastActivityAt,Date.parse('2026-01-01T01:00:00Z'));assert.equal(allowed(sessions),true);
    // A queued follow-up must not hide the turn that is still working.
    db.exec("INSERT INTO orchestration_v2_projection_runs VALUES('queued','quiet',2,'queued')");
    assert.equal((await adapter.poll())[0].status,'Running');
    assert.equal(allowed(await adapter.poll()),true);
    db.exec("INSERT INTO orchestration_v2_projection_runtime_requests VALUES('quiet','pending')");
    sessions=await adapter.poll();assert.equal(sessions[0].status,'Waiting for Input');assert.equal(allowed(sessions),false);
    db.exec("UPDATE orchestration_v2_projection_runtime_requests SET status='resolved'");assert.equal(allowed(await adapter.poll()),true);
    alive=false;await assert.rejects(adapter.poll(),/disconnected/);alive=true;
    startedAt=Date.parse('2026-01-02T00:00:00Z');assert.equal(allowed(await adapter.poll()),false);
    db.exec("UPDATE orchestration_v2_projection_provider_threads SET updated_at='2026-01-02T01:00:00Z'");assert.equal(allowed(await adapter.poll()),true);
    db.exec("UPDATE orchestration_v2_projection_runs SET status='completed'");
    sessions=await adapter.poll();assert.equal(sessions[0].status,'Completed');assert.equal(allowed(sessions),false);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test('live T3 identity needs a valid runtime, matching database and exact port',()=>{
  const runtime={version:1,pid:123,port:3773,startedAt:'2026-01-01T00:00:00Z'};
  assert.equal(validRuntime(runtime),true);assert.equal(validRuntime({...runtime,pid:0}),false);assert.equal(validRuntime({...runtime,port:70000}),false);assert.equal(validRuntime({...runtime,startedAt:'unknown'}),false);
  const files='p123\nn/tmp/state.sqlite\nn*:3773\n';
  assert.equal(ownsDatabaseAndPort(files,'/tmp/state.sqlite',3773),true);
  assert.equal(ownsDatabaseAndPort(files,'/tmp/other.sqlite',3773),false);
  assert.equal(ownsDatabaseAndPort(files,'/tmp/state.sqlite',377),false);
});

test('T3 subthreads without an app run use their latest actual provider turn',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'p2s-t3-native-'));const path=join(dir,'statev2.sqlite');const db=new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT,title TEXT,active_provider_thread_id TEXT,deleted_at TEXT,archived_at TEXT,updated_at TEXT);
      CREATE TABLE orchestration_v2_projection_runs(run_id TEXT,thread_id TEXT,ordinal INTEGER,status TEXT);
      CREATE TABLE orchestration_v2_projection_runtime_requests(thread_id TEXT,status TEXT);
      CREATE TABLE orchestration_v2_projection_provider_threads(thread_id TEXT,status TEXT,updated_at TEXT);
      CREATE TABLE orchestration_v2_projection_provider_turns(provider_turn_id TEXT,provider_thread_id TEXT,ordinal INTEGER,status TEXT);
      INSERT INTO orchestration_v2_projection_threads VALUES('child','Coding subthread','native-provider',NULL,NULL,'2026-01-01T01:00:00Z');
      INSERT INTO orchestration_v2_projection_provider_threads VALUES('child','active','2026-01-01T01:00:00Z');
      INSERT INTO orchestration_v2_projection_provider_turns VALUES('previous','native-provider',1,'completed');
      INSERT INTO orchestration_v2_projection_provider_turns VALUES('current','native-provider',2,'running');`);
    const adapter=new T3Adapter(path,async()=>({startedAt:Date.parse('2026-01-01T00:00:00Z')}));
    const read=async()=>(await adapter.poll())[0];
    let session=await read();assert.equal(session.status,'Running');assert.equal(fresh(session.observedAt),true);
    db.exec("INSERT INTO orchestration_v2_projection_runtime_requests VALUES('child','pending')");assert.equal((await read()).status,'Waiting for Input');
    db.exec("UPDATE orchestration_v2_projection_runtime_requests SET status='resolved'");assert.equal((await read()).status,'Running');
    // A connected/active provider alone must not turn finished work into Running.
    db.exec("UPDATE orchestration_v2_projection_provider_turns SET status='completed' WHERE provider_turn_id='current'");assert.equal((await read()).status,'Completed');
    db.exec("UPDATE orchestration_v2_projection_provider_turns SET status='failed' WHERE provider_turn_id='current'");assert.equal((await read()).status,'Error');
    db.exec("DELETE FROM orchestration_v2_projection_provider_turns");assert.equal((await read()).status,'Idle');
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test('selected T3 threads remain live outside the recent 100 and expose a native Open link',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'p2s-t3-selected-'));const path=join(dir,'statev2.sqlite');const db=new DatabaseSync(path);
 const thread='22222222-2222-4222-8222-222222222222';
 try{
  const {writeFileSync}=await import('node:fs');writeFileSync(join(dir,'environment-id'),'11111111-1111-4111-8111-111111111111');
  db.exec(`CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT,title TEXT,active_provider_thread_id TEXT,deleted_at TEXT,archived_at TEXT,updated_at TEXT);
   CREATE TABLE orchestration_v2_projection_runs(run_id TEXT,thread_id TEXT,ordinal INTEGER,status TEXT);
   CREATE TABLE orchestration_v2_projection_runtime_requests(thread_id TEXT,status TEXT);
   CREATE TABLE orchestration_v2_projection_provider_threads(thread_id TEXT,status TEXT,updated_at TEXT);
   CREATE TABLE orchestration_v2_projection_provider_turns(provider_turn_id TEXT,provider_thread_id TEXT,ordinal INTEGER,status TEXT);`);
  const insert=db.prepare('INSERT INTO orchestration_v2_projection_threads VALUES(?,?,NULL,NULL,NULL,?)');
  insert.run(thread,'Old selected work','2026-01-01T01:00:00Z');
  for(let n=0;n<105;n++)insert.run(`recent-${n}`,'Recent work','2026-01-03T01:00:00Z');
  db.prepare('INSERT INTO orchestration_v2_projection_runs VALUES(?,?,1,?)').run('old-run',thread,'running');
  db.prepare('INSERT INTO orchestration_v2_projection_provider_threads VALUES(?,?,?)').run(thread,'active','2026-01-02T01:00:00Z');
  const adapter=new T3Adapter(path,async()=>({startedAt:Date.parse('2026-01-02T00:00:00Z'),openScheme:'t3code'}));
  db.exec("UPDATE orchestration_v2_projection_runs SET status='completed'");
  assert.equal((await adapter.poll()).some(s=>s.id===`t3:${thread}`),false);
  assert.equal((await adapter.poll([`t3:${thread}`])).find(s=>s.id===`t3:${thread}`)!.status,'Completed');
  db.exec("UPDATE orchestration_v2_projection_runs SET status='running'");
  assert.equal((await adapter.poll()).some(s=>s.id===`t3:${thread}`),true,'active threads outside the recent 100 count in any-agent mode');
  const selected=await adapter.poll([`t3:${thread}`]);assert.equal(selected.length,101);
  const session=selected.find(s=>s.id===`t3:${thread}`)!;assert.equal(session.status,'Running');assert.ok(fresh(session.observedAt));
  assert.equal(session.openUrl,`t3code://threads/11111111-1111-4111-8111-111111111111/${thread}`);
  db.prepare('UPDATE orchestration_v2_projection_threads SET archived_at=? WHERE thread_id=?').run('2026-01-03T01:00:00Z',thread);
  assert.ok((await adapter.poll([`t3:${thread}`])).some(s=>s.id===`t3:${thread}`));
  db.prepare('UPDATE orchestration_v2_projection_threads SET deleted_at=? WHERE thread_id=?').run('2026-01-03T01:00:00Z',thread);
  assert.equal((await adapter.poll([`t3:${thread}`])).some(s=>s.id===`t3:${thread}`),false);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
