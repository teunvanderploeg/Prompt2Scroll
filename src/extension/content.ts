import { PageOverlay } from './page-overlay.js';
import uiCSS from './ui.css';
import { DEFAULTS, matches } from '../shared/policy.js';
const overlay=new PageOverlay();let lastReply=0;let domains=DEFAULTS.domains;let latestState:any;
let notice:HTMLDivElement|undefined;let countdownTimer:ReturnType<typeof setInterval>|undefined;
let countdownAt=0;let counter:HTMLSpanElement|undefined;let description:HTMLParagraphElement|undefined;
function clearNotice(){
  notice?.remove();notice=undefined;counter=undefined;description=undefined;countdownAt=0;
  if(countdownTimer!==undefined)clearInterval(countdownTimer);countdownTimer=undefined;
}
function cover(reason?:string) {
  clearNotice();
  if(matches(location.href,domains))overlay.show(latestState,reason);
}
function tickCountdown(){
  const remaining=Math.ceil((countdownAt-Date.now())/1000);
  if(remaining<=0){cover();return;}
  if(counter && counter.textContent!==String(remaining))counter.textContent=String(remaining);
  if(description){const text=`Covering this page in ${remaining} seconds.`;if(description.textContent!==text)description.textContent=text;}
}
function warn(state:any){
  overlay.hide();countdownAt=state.blockAt;
  if(!notice?.isConnected){
    notice=document.createElement('div');
    notice.dataset.prompt2scrollOverlay='countdown';
    notice.style.cssText='all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;display:block;width:320px;max-width:calc(100vw - 32px);box-sizing:border-box;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);box-shadow:0 8px 32px #18213c26;padding:16px;font:13px/1.45 system-ui,-apple-system,sans-serif;pointer-events:none;';
    const root=notice.attachShadow({mode:'closed'});
    const style=document.createElement('style');style.textContent=uiCSS;root.append(style);
    const heading=document.createElement('div');heading.style.cssText='display:flex;align-items:center;gap:12px;';
    counter=document.createElement('span');counter.setAttribute('aria-hidden','true');counter.style.cssText='display:grid;place-items:center;flex:0 0 38px;height:38px;border-radius:50%;background:var(--button-bg);color:var(--button-ink);font-size:22px;font-weight:650;';
    const title=document.createElement('strong');title.textContent='Your agent needs attention';title.style.cssText='font-size:14px;font-weight:650;';heading.append(counter,title);
    const agent=document.createElement('p');agent.style.cssText='margin:12px 0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);';
    const session=state.gate.attention[0];agent.textContent=session?`${session.agent}: ${session.task || session.name}`:'Check your selected threads.';
    description=document.createElement('p');description.style.cssText='margin:0;font-size:12px;color:var(--muted);';description.setAttribute('role','status');description.setAttribute('aria-live','polite');
    root.append(heading,agent,description);document.documentElement?.append(notice);
  }
  notice!.dataset.theme=state.settings.darkMode?'dark':'light';
  tickCountdown();
  if(countdownTimer===undefined)countdownTimer=setInterval(tickCountdown,100);
}
function apply(state:any){
  latestState=state;lastReply=Date.now();domains=state.settings.domains;
  if(state.gate.allowed || !matches(location.href,domains)){clearNotice();overlay.hide();}
  else if(typeof state.blockAt==='number' && state.blockAt>Date.now()){overlay.hide();if(window===window.top)warn(state);}
  else cover();
}
// Dispose a live instance on reinjection. Firefox can leave DOM from an unloaded
// extension context behind, so also remove its owned cover without reloading the site.
const context=globalThis as typeof globalThis & { __prompt2scrollContent?:boolean|{dispose:()=>void} };
try{if(typeof context.__prompt2scrollContent==='object')context.__prompt2scrollContent.dispose();}catch{}
let orphanedCover=false;
for(const element of [...document.documentElement.children]){
  if(!(element instanceof HTMLElement))continue;
  const legacy=element.tagName==='DIV'&&element.style.position==='fixed'&&element.style.zIndex==='2147483647'&&element.style.getPropertyValue('overscroll-behavior')==='contain'&&element.style.backgroundColor==='rgb(245, 247, 252)';
  if(element.dataset.prompt2scrollOverlay||legacy){if(element.dataset.prompt2scrollOverlay==='attention'||legacy)orphanedCover=true;element.remove();}
}
if(orphanedCover&&document.body){
  if(document.body.getAttribute('data-prompt2scroll-inert')!=='true')document.body.removeAttribute('inert');document.body.removeAttribute('data-prompt2scroll-inert');
}
{
  cover();
  const receive=(message:any)=>{
    if(active&&message.type==='state'){apply(message);return Promise.resolve({protected:true});}
  };
  browser.runtime.onMessage.addListener(receive);
  async function check(){try{const state=await browser.runtime.sendMessage({type:'get'});if(!active)return;if(state)apply(state);else cover('Cannot check agent status. Sites stay blocked.');}catch{if(active)cover('Companion disconnected. Sites stay blocked.');}}
  let active=true;
  const interval=setInterval(()=>{if(!active)return;if(Date.now()-lastReply>2500)cover('Companion disconnected. Sites stay blocked.');void check();},1000);
  context.__prompt2scrollContent={dispose:()=>{active=false;clearInterval(interval);clearNotice();overlay.hide();try{browser.runtime.onMessage.removeListener(receive);}catch{}}};
  void check();
}
