import { SessionList, SessionRow } from './session-row.js';
import { activityBounds, DEFAULT_ACTIVITY, filterThreads, type ActivityFilter } from './thread-filters.js';
import { DEFAULTS, missingSession, normalizeDomain, type Session, type Settings } from '../shared/policy.js';

let settings:Settings=structuredClone(DEFAULTS);let saving=false;let saveQueue=Promise.resolve();let pendingSaves=0;
let sessions:Session[]=[];let refreshing=false;let viewReady=false;
const PAGES=['threads','websites','settings'] as const;
type Page=typeof PAGES[number];
const list=document.querySelector<HTMLElement>('#sessions')!;
const monitored=document.querySelector<HTMLElement>('#monitored-sessions')!;
let popupView:{page:Page;scroll:number;monitoredScroll:number}={page:'threads',scroll:0,monitoredScroll:0};
const toggle=(id:string,on:boolean)=>{if(settings.anyRunning||saving)return;void save(current=>({selected:on?[...new Set([...current.selected,id])]:current.selected.filter(x=>x!==id)}));};
const rowCache=new Map<string,SessionRow>();
const availableList=new SessionList(list,toggle,rowCache);const monitoredList=new SessionList(monitored,toggle,rowCache);
const websiteRows=new Map<string,HTMLElement>();
type Changes=Partial<Settings>|((current:Settings)=>Partial<Settings>);
function save(changes:Changes):Promise<boolean>{
  const focused=document.activeElement as HTMLElement|null;
  saving=true;pendingSaves++;setBusy();
  const result=saveQueue.then(async()=>{
    const next={...settings,...(typeof changes==='function'?changes(settings):changes)};
    try{
      const state=await browser.runtime.sendMessage({type:'save',settings:next});
      if(!state?.settings)throw new Error('Settings were not saved. Reopen the popup and try again.');
      settings=state.settings;applyAppearance();document.querySelector('#error')!.textContent='';renderThreads();renderWebsites();return true;
    }catch(e){document.querySelector('#error')!.textContent=e instanceof Error?e.message:String(e);return false;}
    finally{pendingSaves--;saving=pendingSaves>0;setBusy();if(!saving){await refresh();if(focused?.isConnected&&focused.closest('.session')&&document.activeElement===document.body)focused.focus({preventScroll:true});}}
  });
  saveQueue=result.then(()=>{});return result;
}
function setBusy(){for(const input of document.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))input.disabled=saving||(settings.anyRunning===true&&!!input.closest('.session'));}
function applyAppearance(){document.documentElement.dataset.theme=settings.darkMode?'dark':'light';document.body.classList.toggle('any-running',settings.anyRunning===true);document.querySelector<HTMLInputElement>('#dark-mode')!.checked=settings.darkMode===true;document.querySelector<HTMLInputElement>('#any-running')!.checked=settings.anyRunning===true;}
async function refresh(){
  if(saving||refreshing)return;refreshing=true;
  try{
    const state=await browser.runtime.sendMessage({type:'get'});
    if(saving)return;
    settings=state.settings;applyAppearance();
    document.querySelector('#connection')!.textContent=state.connected?(state.snapshot?.diagnostics.join(' ')||'Companion connected.'):'Companion disconnected. Sites stay blocked.';
    sessions=[...(state.snapshot?.sessions??[])];
    for(const id of settings.selected)if(!sessions.some(s=>s.id===id))sessions.push(missingSession(id));
    updateSources();renderThreads();renderWebsites();
    const seconds=document.querySelector<HTMLInputElement>('#countdown-seconds')!;
    if(seconds.dataset.dirty!=='true'&&document.activeElement!==seconds)seconds.value=String(settings.countdownSeconds??DEFAULTS.countdownSeconds);
  }catch{document.querySelector('#connection')!.textContent='Could not read agent status. Sites stay blocked.';sessions=sessions.map(s=>({...s,uncertainReason:'Could not read status from the extension background.'}));renderThreads();}
  finally{refreshing=false;}
}
function updateSources(){
  const select=document.querySelector<HTMLSelectElement>('#agent-filter')!;
  const agents=[...new Set([...sessions.map(s=>s.agent),...(select.value?[select.value]:[])])].sort();
  if(JSON.stringify([...select.options].slice(1).map(option=>option.value))===JSON.stringify(agents))return;
  const value=select.value;select.replaceChildren(new Option('All sources',''),...agents.map(agent=>new Option(agent,agent)));select.value=value;
}
function readActivity():ActivityFilter{return {period:document.querySelector<HTMLSelectElement>('#activity-period')!.value,oldest:document.querySelector<HTMLInputElement>('#activity-oldest')!.value,newest:document.querySelector<HTMLInputElement>('#activity-newest')!.value};}
function readFilters(){return {query:document.querySelector<HTMLInputElement>('#thread-search')!.value,agent:document.querySelector<HTMLSelectElement>('#agent-filter')!.value,status:document.querySelector<HTMLSelectElement>('#status-filter')!.value};}
function filtersChanged(){renderThreads();void browser.storage.local.set({threadFilters:{...readFilters(),activity:readActivity()}}).catch(()=>{});}
function renderThreads(){
  const focused=document.activeElement as HTMLElement|null;
  const filters=readFilters();const activity=readActivity();const bounds=activityBounds(activity);
  document.querySelector<HTMLElement>('#activity-range')!.hidden=activity.period!=='custom';
  document.querySelector('#activity-error')!.textContent=bounds.error??'';
  const selected=settings.selected.map(id=>sessions.find(s=>s.id===id)??missingSession(id));
  document.querySelector<HTMLElement>('#monitor-mode')!.hidden=!settings.anyRunning;
  document.querySelector('#monitored-label')!.textContent=settings.anyRunning?'Saved selection':'Monitoring';
  document.querySelector('#monitored-section')!.setAttribute('aria-label',settings.anyRunning?'Saved thread selection':'Monitored threads');
  const other=sessions.filter(s=>!settings.selected.includes(s.id)).sort((a,b)=>(b.lastActivityAt||0)-(a.lastActivityAt||0)||a.id.localeCompare(b.id));
  const visible=bounds.error?[]:filterThreads(other,settings.selected,{...filters,...bounds});
  document.querySelector<HTMLElement>('#monitored-section')!.hidden=!selected.length;
  document.querySelector('#monitored-count')!.textContent=String(selected.length);
  document.body.classList.toggle('has-monitored',selected.length>0);
  const selectionLabel=settings.anyRunning?'Saved selection':'Monitor';
  monitoredList.render(selected,settings.selected,selectionLabel);availableList.render(visible,settings.selected,selectionLabel);setBusy();
  if(focused?.isConnected&&focused.closest('.session')&&document.activeElement!==focused&&!saving)focused.focus({preventScroll:true});
  const visibleIds=new Set([...selected,...visible].map(s=>s.id));for(const id of rowCache.keys())if(!visibleIds.has(id))rowCache.delete(id);
  const count=document.querySelector<HTMLElement>('#thread-count')!;count.textContent=`${visible.length} / ${other.length}`;count.title='Matching threads, excluding monitored threads';
  const empty=document.querySelector<HTMLElement>('#threads-empty')!;empty.hidden=!!visible.length||!!bounds.error;
  empty.textContent=other.length?'No threads match these filters.':selected.length?'No other threads.':'Start a monitored agent. It will appear here.';
}
function renderWebsites(){
  const container=document.querySelector<HTMLElement>('#domains')!;
  for(const [domain,item] of websiteRows)if(!settings.domains.includes(domain)){item.remove();websiteRows.delete(domain);}
  settings.domains.forEach((domain,index)=>{
    let item=websiteRows.get(domain);
    if(!item){
      item=document.createElement('div');item.className='website';
      const name=document.createElement('span');name.textContent=domain;name.title=domain;
      const remove=document.createElement('button');remove.type='button';remove.className='remove-site';remove.textContent='×';remove.setAttribute('aria-label',`Remove ${domain}`);
      remove.addEventListener('click',async()=>{
        remove.disabled=true;
        await save(current=>({domains:current.domains.filter(value=>value!==domain)}));remove.disabled=false;
      });
      item.append(name,remove);websiteRows.set(domain,item);
    }
    const current=container.children[index];if(current!==item)container.insertBefore(item,current??null);
  });
}
function persistView(){void browser.storage.local.set({popupView}).catch(()=>{});}
function showPage(page:Page,focus=false,persist=true){
  popupView.page=page;
  for(const name of PAGES){const active=name===page;const tab=document.querySelector<HTMLButtonElement>(`#${name}-tab`)!;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;document.querySelector<HTMLElement>(`#${name}-panel`)!.hidden=!active;if(active&&focus)tab.focus();}
  if(page==='threads'&&viewReady){list.scrollTop=popupView.scroll;monitored.scrollTop=popupView.monitoredScroll;}
  if(persist)persistView();
}
async function start(){
  try{
    const {threadFilters,popupView:savedView}=await browser.storage.local.get(['threadFilters','popupView']);
    if(threadFilters){
      document.querySelector<HTMLInputElement>('#thread-search')!.value=typeof threadFilters.query==='string'?threadFilters.query:'';
      const agent=document.querySelector<HTMLSelectElement>('#agent-filter')!;
      if(typeof threadFilters.agent==='string'&&threadFilters.agent){agent.add(new Option(threadFilters.agent,threadFilters.agent));agent.value=threadFilters.agent;}
      const status=document.querySelector<HTMLSelectElement>('#status-filter')!;if([...status.options].some(option=>option.value===threadFilters.status))status.value=threadFilters.status;
      const activity={...DEFAULT_ACTIVITY,...threadFilters.activity};const period=document.querySelector<HTMLSelectElement>('#activity-period')!;
      if([...period.options].some(option=>option.value===activity.period))period.value=activity.period;
      for(const field of ['oldest','newest'] as const)if(typeof activity[field]==='string')document.querySelector<HTMLInputElement>(`#activity-${field}`)!.value=activity[field];
    }
    if(savedView){if(PAGES.includes(savedView.page))popupView.page=savedView.page;for(const field of ['scroll','monitoredScroll'] as const)if(Number.isFinite(savedView[field])&&savedView[field]>=0)popupView[field]=savedView[field];}
  }catch{ /* Keep defaults if storage is unavailable. */ }
  showPage(popupView.page,false,false);await refresh();viewReady=true;
  if(popupView.page==='threads'){list.scrollTop=popupView.scroll;monitored.scrollTop=popupView.monitoredScroll;}
  setInterval(()=>void refresh(),1000);
}
for(const page of PAGES)document.querySelector(`#${page}-tab`)!.addEventListener('click',()=>showPage(page));
document.querySelector('.tabs')!.addEventListener('keydown',event=>{
  const e=event as KeyboardEvent;if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
  const index=PAGES.indexOf(popupView.page);const next=e.key==='Home'?0:e.key==='End'?PAGES.length-1:(index+(e.key==='ArrowLeft'?-1:1)+PAGES.length)%PAGES.length;showPage(PAGES[next],true);
});
list.addEventListener('scroll',()=>{if(viewReady&&popupView.page==='threads'){popupView.scroll=list.scrollTop;persistView();}});
monitored.addEventListener('scroll',()=>{if(viewReady&&popupView.page==='threads'){popupView.monitoredScroll=monitored.scrollTop;persistView();}});
document.querySelector('#thread-search')!.addEventListener('input',filtersChanged);
for(const id of ['agent-filter','status-filter','activity-period','activity-oldest','activity-newest'])document.querySelector(`#${id}`)!.addEventListener('change',filtersChanged);
const domainInput=document.querySelector<HTMLInputElement>('#domain-input')!;
domainInput.addEventListener('input',()=>{domainInput.setCustomValidity('');document.querySelector('#site-error')!.textContent='';});
document.querySelector('#sites')!.addEventListener('submit',async event=>{
  event.preventDefault();let domain:string;
  try{domain=normalizeDomain(domainInput.value);}catch{document.querySelector('#site-error')!.textContent='Enter a hostname, such as reddit.com.';domainInput.setAttribute('aria-invalid','true');return;}
  domainInput.removeAttribute('aria-invalid');
  if(settings.domains.includes(domain)){document.querySelector('#site-error')!.textContent='Already added.';return;}
  const value=domainInput.value;
  if(await save(current=>({domains:[...new Set([...current.domains,domain])]}))){if(domainInput.value===value)domainInput.value='';document.querySelector('#site-error')!.textContent='';domainInput.focus();}
});
const seconds=document.querySelector<HTMLInputElement>('#countdown-seconds')!;let countdownEdit=0;let savedTimer:ReturnType<typeof setTimeout>|undefined;
seconds.addEventListener('input',()=>{
  if(savedTimer!==undefined)clearTimeout(savedTimer);savedTimer=undefined;
  const edit=++countdownEdit;seconds.dataset.dirty='true';const status=document.querySelector('#settings-saved')!;
  seconds.setAttribute('aria-invalid',String(!seconds.validity.valid));if(!seconds.validity.valid){status.textContent='Choose a whole number from 0 to 60.';return;}
  status.textContent='Saving…';void save({countdownSeconds:seconds.valueAsNumber}).then(saved=>{if(edit!==countdownEdit)return;if(saved)seconds.dataset.dirty='false';status.textContent=saved?'Saved':'Could not save. Change the value to retry.';if(saved)savedTimer=setTimeout(()=>{if(edit===countdownEdit)status.textContent='';savedTimer=undefined;},2000);});
});
document.querySelector<HTMLInputElement>('#dark-mode')!.addEventListener('change',async event=>{
  const input=event.currentTarget as HTMLInputElement;const darkMode=input.checked;document.documentElement.dataset.theme=darkMode?'dark':'light';
  await save({darkMode});applyAppearance();
});
document.querySelector<HTMLInputElement>('#any-running')!.addEventListener('change',async event=>{
  const anyRunning=(event.currentTarget as HTMLInputElement).checked;
  await save({anyRunning});applyAppearance();
});
document.querySelector('#preferences')!.addEventListener('submit',e=>e.preventDefault());
void start();
