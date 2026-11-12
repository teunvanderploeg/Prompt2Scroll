import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusDetails, sessionURL } from '../src/extension/session-row.js';
import type { Session } from '../src/shared/policy.js';
const session:Session={id:'t3:22222222-2222-4222-8222-222222222222',agent:'T3 Code',name:'T3',task:'Build',status:'Running',observedAt:100_000,shortcut:'Build'};
test('uncertain tooltips show the cause and last checked time without changing the recorded agent state',()=>{
 const stale=statusDetails(session,106_000);assert.equal(stale.status,'Status uncertain');assert.match(stale.tooltip,/No fresh update from T3 Code/);assert.match(stale.tooltip,/Last checked:/);assert.equal(session.status,'Running');
 const disconnected=statusDetails({...session,uncertainReason:'Connection to the companion was lost.'},100_000);assert.equal(disconnected.status,'Status uncertain');assert.match(disconnected.tooltip,/Connection to the companion was lost/);
 const restart=statusDetails({...session,observedAt:0,detail:'Running state belongs to an earlier T3 server.'},100_000);assert.match(restart.tooltip,/earlier T3 server/);assert.match(restart.tooltip,/Not confirmed/);
});
test('Open only accepts a supported T3 link for that exact thread, with Copy as the fallback',()=>{
 const link='t3code://threads/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
 assert.equal(sessionURL({...session,openUrl:link}),link);
 for(const openUrl of ['javascript:alert(1)','https://evil.test',link+'?prompt=run',link+'#x',link.replace('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333')])assert.equal(sessionURL({...session,openUrl}),undefined);
});
