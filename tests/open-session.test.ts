import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openSession} from '../src/companion/open-session.js';
import type {Session} from '../src/shared/policy.js';
const id='22222222-2222-4222-8222-222222222222';
const url=`t3code://threads/11111111-1111-4111-8111-111111111111/${id}`;
const session:Session={id:`t3:${id}`,agent:'T3 Code',name:'T3',task:'Build',status:'Completed',observedAt:Date.now(),shortcut:'Build',openUrl:url};
test('the companion opens the exact app link without a browser or shell command',async()=>{
 const calls:any[]=[];const run=async(command:string,args:string[])=>{calls.push({command,args});};
 await openSession(session,run,'darwin');await openSession(session,run,'linux');
 assert.deepEqual(calls,[{command:'/usr/bin/open',args:[url]},{command:'xdg-open',args:[url]}]);
 for(const openUrl of ['javascript:alert(1)','https://evil.test',url+'?prompt=run',url.replace(id,'33333333-3333-4333-8333-333333333333')])await assert.rejects(openSession({...session,openUrl},run,'darwin'),/does not support/);
 await assert.rejects(openSession(session,run,'unsupported'),/not supported/);assert.equal(calls.length,2);
 await assert.rejects(openSession(session,async()=>{throw new Error('App unavailable');},'darwin'),/App unavailable/);
});
