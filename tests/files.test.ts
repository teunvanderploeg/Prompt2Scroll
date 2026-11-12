import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAdapter } from '../src/companion/adapters/files.js';
import { gate, type Session } from '../src/shared/policy.js';

test('resumed Codex monitor keeps ownership across older monitor heartbeats and shutdowns',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'p2s-files-'));
 const now=Date.now();
 const older:Session={id:'codex:a',agent:'Codex',name:'Codex',task:'Old run',status:'Completed',observedAt:now-2000,shortcut:''};
 const resumed:Session={...older,task:'Resumed run',status:'Running',observedAt:now-1000};
 const write=async(file:string,session:Session,at:number,pid:number|undefined=process.pid)=>writeFile(join(directory,file),JSON.stringify({pid,at,sessions:[session]}));
 try{
  const adapter=new FileAdapter(directory);
  await write('resumed.json',resumed,now);
  for(const heartbeat of [now-1,now+1,now+2]){
   await write('older.json',older,heartbeat);
   const sessions=await adapter.poll();
   assert.equal(sessions.length,1);assert.equal(sessions[0].task,'Resumed run');assert.equal(sessions[0].status,'Running');
   assert.equal(sessions[0].observedAt,now,'freshness still comes from the chosen monitor heartbeat');
  }
  await write('resumed.json',{...resumed,status:'Completed'},now+3);
  await write('older.json',{...older,status:'Running'},now+4);
  assert.equal((await adapter.poll())[0].status,'Completed','the old monitor cannot reopen sites');
  await writeFile(join(directory,'resumed.json'),JSON.stringify({at:now+5,sessions:[resumed]}));
  assert.equal((await adapter.poll())[0].status,'Error','a dead new monitor cannot fall back to an older running monitor');
  await write('resumed.json',resumed,now-6000);
  const sessions=await adapter.poll();
  assert.equal(gate({selected:['codex:a'],domains:[]},{at:now,sessions,diagnostics:[]},true,now).allowed,false,'a stale new monitor also stays blocked');
 }finally{await rm(directory,{recursive:true,force:true});}
});
