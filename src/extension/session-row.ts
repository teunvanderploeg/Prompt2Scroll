import { sessionURL } from '../shared/session-link.js';
export { sessionURL } from '../shared/session-link.js';
import { fresh, type Session } from '../shared/policy.js';

type Toggle=(id:string,on:boolean)=>void;
function setText(element:HTMLElement,text:string){if(element.textContent!==text)element.textContent=text;}
export function statusDetails(s:Session,now=Date.now()){
  const known=!s.uncertainReason&&fresh(s.observedAt,now);
  const status=known?s.status:'Status uncertain';
  const reason=s.uncertainReason??(known?s.detail:s.observedAt===0&&s.detail?s.detail:s.observedAt>now+1000?'Agent update has an invalid future timestamp.':`No fresh update from ${s.agent}.`);
  const checked=s.observedAt>0&&s.observedAt<=now+1000?new Date(s.observedAt).toLocaleTimeString():'Not confirmed';
  return {status,tooltip:[`${s.agent}: ${status}`,reason,`Last checked: ${checked}`].filter(Boolean).join('\n')};
}
export class SessionRow {
  readonly element=document.createElement('div');
  private input:HTMLInputElement|undefined;
  private main:HTMLElement=document.createElement('span');
  private task=document.createElement('span');
  private source=document.createElement('span');
  private status=document.createElement('span');
  private caption=document.createElement('span');
  private feedback=document.createElement('span');
  private feedbackTimer:ReturnType<typeof setTimeout>|undefined;
  private session:Session;
  private kind='none';
  private opening=false;
  constructor(s:Session,selected:boolean,toggle?:Toggle,selectionLabel='Monitor'){
    this.session=s;this.element.className='session';this.element.dataset.id=s.id;
    if(toggle){this.input=document.createElement('input');this.input.type='checkbox';this.input.id=s.id;this.input.addEventListener('change',()=>toggle(this.session.id,this.input!.checked));this.element.append(this.input);}
    this.task.className='task';this.source.className='source';this.status.className='status';
    this.feedback.className='row-feedback';this.feedback.setAttribute('role','status');
    const dot=document.createElement('span');dot.className='status-dot';dot.setAttribute('aria-hidden','true');
    this.status.append(dot,this.caption);this.main.className='session-main';this.main.append(this.task,this.source,this.status,this.feedback);this.element.append(this.main);
    this.element.addEventListener('click',event=>{if(event.target===this.input||this.main.contains(event.target as Node)||event.defaultPrevented)return;this.main.click();});
    this.update(s,selected,selectionLabel);
  }
  private async copy(){
    if(this.feedbackTimer!==undefined)clearTimeout(this.feedbackTimer);
    try{await navigator.clipboard.writeText(this.session.shortcut);this.feedback.textContent='Copied';}
    catch{this.feedback.textContent='Could not copy';}
    this.feedbackTimer=setTimeout(()=>{this.feedback.textContent='';this.feedbackTimer=undefined;},2000);
  }
  private async open(){
    if(this.opening)return;this.opening=true;
    if(this.main instanceof HTMLButtonElement)this.main.disabled=true;
    try{
      const result=await browser.runtime.sendMessage({type:'open-session',id:this.session.id});
      if(!result?.ok)throw new Error('Could not open the agent.');
      this.feedback.textContent='';
      // Dismiss only the toolbar popup. Never close a website or an extension tab.
      try{if(browser.extension?.getViews?.({type:'popup'}).includes(window))window.close();}catch{}
    }catch{
      this.feedback.textContent='Could not open';
      if(this.feedbackTimer!==undefined)clearTimeout(this.feedbackTimer);
      this.feedbackTimer=setTimeout(()=>{this.feedback.textContent='';this.feedbackTimer=undefined;},2000);
    }finally{this.opening=false;if(this.main instanceof HTMLButtonElement)this.main.disabled=false;}
  }
  update(s:Session,selected:boolean,selectionLabel='Monitor'){
    this.session=s;
    if(this.input){this.input.checked=selected;this.input.setAttribute('aria-label',`${selectionLabel} ${s.task||s.name}`);}
    const title=s.task||s.name;const detail=statusDetails(s);
    const activity=typeof s.lastActivityAt==='number'&&Number.isFinite(s.lastActivityAt)?new Date(s.lastActivityAt).toLocaleString(undefined,{dateStyle:'short',timeStyle:'short'}):'Unavailable';
    setText(this.task,title);setText(this.source,s.agent==='T3 Code'?'T3':s.agent);this.source.title=s.agent;
    this.status.dataset.status=detail.status;this.status.title=detail.tooltip;this.status.setAttribute('aria-label',detail.tooltip);
    setText(this.caption,detail.status==='Waiting for Input'?'Needs input':detail.status==='Completed'?'Done':detail.status==='Status uncertain'?'Unknown':detail.status);
    const openUrl=sessionURL(s);const kind=openUrl?'open':s.shortcut?'copy':'none';
    if(kind!==this.kind){
      const next=document.createElement(kind==='none'?'span':'button');next.className='session-main';
      if(next instanceof HTMLButtonElement){next.type='button';next.addEventListener('click',()=>{if(kind==='open')void this.open();else void this.copy();});}
      next.append(this.task,this.source,this.status,this.feedback);this.main.replaceWith(next);this.main=next;this.kind=kind;
    }
    const action=openUrl?`Open in ${s.agent}`:s.shortcut?(s.agent==='T3 Code'?'Copy thread search':'Copy resume command'):'';
    this.main.title=[title,action,detail.tooltip,`Last activity: ${activity}`].filter(Boolean).join('\n');
    if(this.main instanceof HTMLButtonElement)this.main.setAttribute('aria-label',openUrl?`Open ${title}`:`${action}: ${title}`);
  }
}
export function row(s:Session,selected:boolean,toggle?:Toggle){return new SessionRow(s,selected,toggle).element;}

export class SessionList {
  private rows:Map<string,SessionRow>;
  private visible=new Set<string>();
  constructor(private container:HTMLElement,private toggle?:Toggle,private shared?:Map<string,SessionRow>){this.rows=shared??new Map();}
  render(sessions:Session[],selected:readonly string[]=[],selectionLabel='Monitor'){
    const scroll=this.container.scrollTop;const focused=document.activeElement as HTMLElement|null;
    const ids=new Set(sessions.map(s=>s.id));
    for(const id of this.visible)if(!ids.has(id)){const item=this.rows.get(id);if(item?.element.parentElement===this.container)item.element.remove();if(!this.shared)this.rows.delete(id);}
    this.visible=ids;
    sessions.forEach((session,index)=>{
      let item=this.rows.get(session.id);
      if(!item){item=new SessionRow(session,selected.includes(session.id),this.toggle,selectionLabel);this.rows.set(session.id,item);}else item.update(session,selected.includes(session.id),selectionLabel);
      const current=this.container.children[index];if(current!==item.element)this.container.insertBefore(item.element,current??null);
    });
    if(focused?.isConnected&&this.container.contains(focused)&&document.activeElement!==focused)focused.focus({preventScroll:true});
    this.container.scrollTop=scroll;
  }
}
