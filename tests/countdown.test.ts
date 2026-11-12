import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttentionCountdown, countdownSeconds, validCountdownSeconds } from '../src/shared/countdown.js';
test('initial stopped state blocks immediately; a confirmed running-to-stopped transition gets three seconds',()=>{
  const timer=new AttentionCountdown();
  assert.equal(timer.update(false,true,1000),undefined);
  assert.equal(timer.update(true,true,2000),undefined);
  assert.equal(timer.update(false,true,3000),6000);
  assert.equal(timer.update(false,true,5000),6000);
  assert.equal(timer.update(false,true,6000),undefined);
  assert.equal(timer.update(false,true,7000),undefined);
});
test('resuming cancels a countdown; uncertainty cancels it and never grants a grace period',()=>{
  const timer=new AttentionCountdown();timer.update(true,true,1000);
  assert.equal(timer.update(false,true,2000),5000);
  assert.equal(timer.update(true,true,3000),undefined);
  assert.equal(timer.update(false,true,4000),7000);
  assert.equal(timer.update(false,false,4500),undefined);
  timer.update(true,true,5000);
  assert.equal(timer.update(false,false,5500),undefined);
});

test('custom countdown length applies without restarting the current timer',()=>{
  const timer=new AttentionCountdown();timer.update(true,true,1000,8);
  assert.equal(timer.update(false,true,2000,8),10000);
  assert.equal(timer.update(false,true,3000,12),14000);
  assert.equal(timer.update(false,true,4000,3),5000);
  assert.equal(timer.update(false,true,5000,3),undefined);
  // Changing the setting cannot reopen a page whose countdown has expired.
  assert.equal(timer.update(false,true,6000,60),undefined);
});
test('zero seconds blocks immediately',()=>{
  const timer=new AttentionCountdown();timer.update(true,true,1000,0);
  assert.equal(timer.update(false,true,2000,0),undefined);
});

test('countdown settings migrate to three seconds and validate whole seconds from zero to sixty',()=>{
  assert.equal(countdownSeconds(undefined),3);assert.equal(countdownSeconds('bad'),3);
  for(const value of [0,3,12,60]){assert.equal(validCountdownSeconds(value),true);assert.equal(countdownSeconds(value),value);}
  for(const value of [-1,61,2.5,NaN,Infinity,'5',null])assert.equal(validCountdownSeconds(value),false);
});
