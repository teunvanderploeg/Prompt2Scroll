import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, gate, matches, normalizeDomain, type Session, type Snapshot, type Status } from '../src/shared/policy.js';
const now=100_000;
const session=(id:string,status:Status='Running',observedAt=now):Session=>({id,agent:'Codex',name:id,task:'Tests',status,observedAt,shortcut:''});
const settings={...DEFAULTS,selected:['a','b']};
const snapshot=(...sessions:Session[]):Snapshot=>({sessions,at:now,diagnostics:[]});
test('all selected running grants access; unrelated stopped agents do not block',()=>assert.equal(gate(settings,snapshot(session('a'),session('b'),session('c','Error')),true,now).allowed,true));
for(const status of ['Waiting for Input','Completed','Error','Idle'] as Status[])test(`one selected ${status} blocks all sites, then resumes`,()=>{const s=snapshot(session('a'),session('b',status));assert.equal(gate(settings,s,true,now).allowed,false);s.sessions[1].status='Running';assert.equal(gate(settings,s,true,now).allowed,true);});
test('empty selection, missing session, disconnected host, stale host and stale agent block',()=>{
 assert.equal(gate({...settings,selected:[]},snapshot(session('a')),true,now).allowed,false);
 assert.equal(gate(settings,snapshot(session('a')),true,now).allowed,false);
 assert.equal(gate(settings,snapshot(session('a'),session('b')),false,now).allowed,false);
 assert.equal(gate(settings,{...snapshot(session('a'),session('b')),at:now-6000},true,now).allowed,false);
 assert.equal(gate(settings,snapshot(session('a'),session('b','Running',now-6000)),true,now).allowed,false);
 assert.equal(gate(settings,snapshot(session('a'),session('b','Running',now+5000)),true,now).allowed,false);
});
test('hostname matching covers subdomains without substring bypasses',()=>{
 for(const url of ['https://reddit.com','https://old.reddit.com/r/test','https://reddit.com:443'])assert.equal(matches(url,['reddit.com']),true);
 for(const url of ['https://reddit.com.evil.test','https://notreddit.com','https://reddit.com@evil.test','file:///reddit.com'])assert.equal(matches(url,['reddit.com']),false);
 assert.equal(normalizeDomain('HTTPS://Reddit.COM/'),'reddit.com');
 for(const v of ['*.reddit.com','https://reddit.com/r/test','reddit.com:42','https://a@reddit.com','reddit com'])assert.throws(()=>normalizeDomain(v));
});

test('any-agent mode allows one fresh running session without selecting it',()=>{
 const any={...settings,selected:[],anyRunning:true};
 for(const status of ['Waiting for Input','Completed','Error','Idle'] as Status[]){
  assert.equal(gate(any,snapshot(session('a',status),session('b')),true,now).allowed,true);
  assert.equal(gate(any,snapshot(session('a',status),session('b',status)),true,now).allowed,false);
 }
 assert.equal(gate({...any,selected:['missing']},snapshot(session('unselected')),true,now).allowed,true);
 assert.equal(gate(any,snapshot(),true,now).allowed,false);
});
test('any-agent mode rejects stale, uncertain and disconnected running observations',()=>{
 const any={...settings,selected:[],anyRunning:true};
 for(const observedAt of [now-6000,now+5000])assert.equal(gate(any,snapshot(session('a','Running',observedAt)),true,now).allowed,false);
 assert.equal(gate(any,snapshot({...session('a'),uncertainReason:'Connection lost'}),true,now).allowed,false);
 assert.equal(gate(any,snapshot(session('a')),false,now).allowed,false);
 assert.equal(gate(any,{...snapshot(session('a')),at:now-6000},true,now).allowed,false);
 assert.equal(gate(any,snapshot(session('old','Running',now-6000),session('fresh')),true,now).allowed,true);
});
