import { SessionList } from './session-row.js';
import { matches } from '../shared/policy.js';
const url=new URL(location.href).searchParams.get('url');
const agents=new SessionList(document.querySelector('#agents')!);
async function refresh(){
  const reason=document.querySelector<HTMLElement>('#reason')!;
  try{
    const state=await browser.runtime.sendMessage({type:'get'});
    document.documentElement.dataset.theme=state.settings.darkMode?'dark':'light';
    if(url&&/^https?:/.test(url)&&(state.gate.allowed||!matches(url,state.settings.domains))){location.replace(url);return;}
    reason.textContent=state.gate.reason;reason.hidden=state.gate.attention.length>0;agents.render(state.gate.attention);
  }catch{reason.hidden=false;reason.textContent='Companion disconnected. Sites stay blocked.';}
}
void refresh();setInterval(()=>void refresh(),1000);
