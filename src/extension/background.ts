import { AttentionCountdown, countdownSeconds, validCountdownSeconds } from '../shared/countdown.js';
import { DEFAULTS, fresh, gate, isRunning, matches, missingSession, normalizeDomain, type Session, type Settings, type Snapshot } from '../shared/policy.js';
import { sessionURL } from '../shared/session-link.js';
let settings: Settings = structuredClone(DEFAULTS); let snapshot: Snapshot | undefined; let connected=false;
let port: browser.runtime.Port | undefined; let initialized=false;
const remembered=new Map<string,Session>();let memoryKey='';
const lastRunning=new Map<string,Session>();
const countdown=new AttentionCountdown();
const allowedTabs=new Set<number>();
const preservedTabs=new Set<number>();
type OpenResult={ok:boolean;error?:string};
const pendingOpens=new Map<string,{resolve:(result:OpenResult)=>void;timer:ReturnType<typeof setTimeout>}>();let nextOpen=0;
function finishOpen(requestId:string,result:OpenResult){const pending=pendingOpens.get(requestId);if(!pending)return;clearTimeout(pending.timer);pendingOpens.delete(requestId);pending.resolve(result);}
function openInAgent(id:string):Promise<OpenResult>{
  if(!connected||!port)return Promise.resolve({ok:false,error:'Companion disconnected.'});
  const requestId=`open:${++nextOpen}`;
  return new Promise(resolve=>{
    const timer=setTimeout(()=>finishOpen(requestId,{ok:false,error:'The agent did not open in time.'}),7000);pendingOpens.set(requestId,{resolve,timer});
    try{port!.postMessage({type:'open-session',id,requestId});}catch{finishOpen(requestId,{ok:false,error:'Companion disconnected.'});}
  });
}
let scheduledAt:number|undefined;let blockTimer:ReturnType<typeof setTimeout>|undefined;
const ready = browser.storage.local.get(['settings','sessionMemory']).then(x => {
  if(x.settings)settings={countdownSeconds:countdownSeconds(x.settings.countdownSeconds),darkMode:x.settings.darkMode===true,anyRunning:x.settings.anyRunning===true,selected:Array.isArray(x.settings.selected)?x.settings.selected:[],domains:Array.isArray(x.settings.domains)?x.settings.domains.map(normalizeDomain):DEFAULTS.domains};
  if(Array.isArray(x.sessionMemory))for(const s of x.sessionMemory)if(s&&typeof s.id==='string'&&settings.selected.includes(s.id))remembered.set(s.id,s);
}).catch(()=>{}).finally(()=>{initialized=true;});
function remember(){
  for(const session of snapshot?.sessions??[])if(settings.selected.includes(session.id))remembered.set(session.id,session);
  for(const id of remembered.keys())if(!settings.selected.includes(id))remembered.delete(id);
  // Store identity only; saved metadata can never renew an agent's status.
  const sessionMemory=[...remembered.values()].map(s=>({...s,observedAt:0}));
  const key=JSON.stringify(sessionMemory);if(key===memoryKey)return;memoryKey=key;
  void browser.storage.local.set({sessionMemory}).catch(()=>{memoryKey='';});
}
function watch(){try{port?.postMessage({type:'watch',selected:settings.selected});}catch{}}
function displaySnapshot():Snapshot{
  const unavailable=!connected||!snapshot||!fresh(snapshot.at);
  const sessions=(snapshot?.sessions??[]).map(s=>unavailable?{...s,uncertainReason:'Connection to the companion was lost.'}:s);
  for(const id of settings.selected)if(!sessions.some(s=>s.id===id)){
    const agent=id.startsWith('t3:')?'T3 Code':id.startsWith('opencode:')?'OpenCode':'Codex';
    const diagnostic=snapshot?.diagnostics?.find(text=>text.startsWith(agent));
    sessions.push(missingSession(id,remembered.get(id),unavailable?'Connection to the companion was lost.':diagnostic??'Session is unavailable. It may have been closed or deleted.'));
  }
  return {sessions,at:snapshot?.at??0,diagnostics:snapshot?.diagnostics??[]};
}
function view(tabId?:number) {
  const displayed=displaySnapshot();const decision=gate(settings,displayed,connected);
  if(settings.anyRunning&&decision.allowed){lastRunning.clear();for(const session of displayed.sessions)if(isRunning(session))lastRunning.set(session.id,session);}
  if(settings.anyRunning&&!decision.allowed&&lastRunning.size){decision.attention=[...lastRunning].map(([id,previous])=>displayed.sessions.find(s=>s.id===id)??missingSession(id,previous)).slice(0,3);}
  const required=settings.anyRunning?[...lastRunning.keys()]:settings.selected;
  const confirmed=connected && !!snapshot && fresh(snapshot.at) && required.length>0 && required.every(id=>snapshot!.sessions.some(s=>s.id===id && !s.uncertainReason && fresh(s.observedAt) && ['Running','Waiting for Input','Completed','Error','Idle'].includes(s.status)));
  const deadline=countdown.update(decision.allowed,confirmed,Date.now(),settings.countdownSeconds);
  if(deadline!==scheduledAt){
    if(blockTimer!==undefined)clearTimeout(blockTimer);
    scheduledAt=deadline;
    blockTimer=deadline===undefined?undefined:setTimeout(()=>{scheduledAt=undefined;blockTimer=undefined;void enforce();},Math.max(0,deadline-Date.now()));
  }
  return {settings,snapshot:displayed,connected,gate:decision,blockAt:tabId!==undefined && allowedTabs.has(tabId)?deadline:undefined};
}
function blockedURL(url:string) { return browser.runtime.getURL(`blocked.html?url=${encodeURIComponent(url)}`); }
function isBlockedPage(url:string) { return url.startsWith(browser.runtime.getURL('blocked.html')); }
async function notifyTab(tabId:number){
  let message={type:'state',...view(tabId)};
  let response:any;
  try{response=await browser.tabs.sendMessage(tabId,message,{frameId:0});}catch{}
  if(!response?.protected){
    try{
      await browser.tabs.executeScript(tabId,{file:'content.js',allFrames:true,runAt:'document_start'});
      message={type:'state',...view(tabId)};
      response=await browser.tabs.sendMessage(tabId,message,{frameId:0});
    }catch{}
  }
  if(response?.protected){
    preservedTabs.add(tabId);
    // Also pause media in matching child frames, whose own scripts keep their state.
    void browser.tabs.sendMessage(tabId,message).catch(()=>{});
  }else{
    preservedTabs.delete(tabId);
    // Firefox can forbid content scripts on protected pages. Keep that fallback closed.
    if(!message.gate.allowed){const tab=await browser.tabs.get(tabId);if(tab.url&&matches(tab.url,settings.domains))await browser.tabs.update(tabId,{url:blockedURL(tab.url)});}
  }
}
let enforcing=false;let enforceAgain=false;
async function enforce(){
  if(enforcing){enforceAgain=true;return;}
  enforcing=true;
  try{do{enforceAgain=false;await enforceOnce();}while(enforceAgain);}finally{enforcing=false;}
}
async function enforceOnce() {
  const state=view();
  void browser.browserAction.setBadgeText({text:state.gate.allowed?'':'!'});
  void browser.browserAction.setBadgeBackgroundColor({color:'#264ab9'});
  const tabs=await browser.tabs.query({});
  await Promise.all(tabs.map(async tab=> {
    if(tab.id===undefined || !tab.url) return;
    try {
      if(isBlockedPage(tab.url)) { const url=new URL(tab.url).searchParams.get('url'); if(url && (state.gate.allowed || !matches(url,settings.domains)) && /^https?:/.test(url)) {if(state.gate.allowed && matches(url,settings.domains))allowedTabs.add(tab.id);await browser.tabs.update(tab.id,{url});} }
      else if(matches(tab.url,settings.domains)) {
        const current=view(tab.id);
        if(current.gate.allowed)allowedTabs.add(tab.id);
        else if(current.blockAt===undefined)allowedTabs.delete(tab.id);
        await notifyTab(tab.id);
      }
      else {allowedTabs.delete(tab.id);preservedTabs.delete(tab.id);await browser.tabs.sendMessage(tab.id,{type:'state',...state}).catch(()=>{});}
    } catch { /* A tab may close during an update. */ }
  }));
}
function connect() {
  try {
    port=browser.runtime.connectNative('local.prompt2scroll');
    watch();
    port.onMessage.addListener((raw:object)=> {
      const result=raw as {type?:string;requestId?:string;ok?:boolean;error?:string};
      if(result?.type==='open-result'){if(typeof result.requestId==='string')finishOpen(result.requestId,{ok:result.ok===true,error:result.error});return;}
      const value=raw as Snapshot;if(!value||!Array.isArray(value.sessions)||typeof value.at!=='number'){connected=false;snapshot=undefined;}else{snapshot=value;connected=true;remember();}void enforce();
    });
    port.onDisconnect.addListener(()=>{ void browser.runtime.lastError;connected=false;snapshot=undefined;for(const requestId of pendingOpens.keys())finishOpen(requestId,{ok:false,error:'Companion disconnected.'});void enforce();setTimeout(connect,2000); });
  } catch { connected=false; setTimeout(connect,2000); }
}
browser.webRequest.onBeforeRequest.addListener(async details=>{
  await ready;
  if(details.type==='main_frame')preservedTabs.delete(details.tabId);
  const state=view(details.tabId);
  if(matches(details.url,settings.domains) && !state.gate.allowed) {
    if(details.type!=='main_frame' && (preservedTabs.has(details.tabId) || (state.blockAt!==undefined && state.blockAt>Date.now())))return {};
    return details.type==='main_frame' ? {redirectUrl:blockedURL(details.url)} : {cancel:true};
  }
  return {};
},{urls:['<all_urls>']},['blocking']);
browser.runtime.onMessage.addListener(async (message,sender)=>{
  await ready;
  if(message.type==='get') return view(sender.tab?.id);
  if(message.type==='open-session'){
    const ownPage=sender.url?.startsWith(browser.runtime.getURL(''));
    const ownCover=typeof sender.id==='string'&&sender.id===browser.runtime.id&&!!sender.tab&&matches(sender.url??sender.tab.url??'',settings.domains);
    if(!ownPage&&!ownCover)return;
    const session=snapshot?.sessions.find(s=>s.id===message.id)??remembered.get(message.id);
    if(!session||!sessionURL(session))return {ok:false,error:'Session cannot be opened.'};
    return openInAgent(session.id);
  }
  // Only extension documents may change settings.
  if(message.type==='save' && sender.url?.startsWith(browser.runtime.getURL(''))) {
    const value=message.settings.countdownSeconds;
    if(value!==undefined && !validCountdownSeconds(value))throw new Error('Choose a whole number of seconds from 0 to 60.');
    if(message.settings.darkMode!==undefined&&typeof message.settings.darkMode!=='boolean')throw new Error('Dark mode must be on or off.');
    if(message.settings.anyRunning!==undefined&&typeof message.settings.anyRunning!=='boolean')throw new Error('Any running agent must be on or off.');
    const next:Settings={countdownSeconds:countdownSeconds(value===undefined?settings.countdownSeconds:value),darkMode:message.settings.darkMode??settings.darkMode??false,anyRunning:message.settings.anyRunning??settings.anyRunning??false,selected:[...new Set<string>(message.settings.selected)],domains:[...new Set<string>(message.settings.domains.map(normalizeDomain))]};
    await browser.storage.local.set({settings:next});if(next.anyRunning!==settings.anyRunning)lastRunning.clear();settings=next;remember();watch();void enforce();return view();
  }
});
browser.tabs.onRemoved.addListener(id=>{allowedTabs.delete(id);preservedTabs.delete(id);});
browser.tabs.onUpdated.addListener((_id,change)=>{if(change.url) void enforce();});
setInterval(()=>{if(initialized) void enforce();},1000);
void ready.then(()=>{connect(); return enforce();});
