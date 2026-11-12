import { SessionList } from './session-row.js';
const agents=new SessionList(document.querySelector('#agents')!);
async function refresh(){
  const reason=document.querySelector<HTMLElement>('#reason')!;
  try{
    const state=await browser.runtime.sendMessage({type:'get'});
    document.documentElement.dataset.theme=state.settings.darkMode?'dark':'light';
    // The background owns returning to the site. Navigating here as well can
    // cancel its in-flight request, especially when the destination loads slowly.
    reason.textContent=state.gate.reason;reason.hidden=state.gate.attention.length>0;agents.render(state.gate.attention);
  }catch{reason.hidden=false;reason.textContent='Companion disconnected. Sites stay blocked.';}
}
void refresh();setInterval(()=>void refresh(),1000);
