import uiCSS from './ui.css';
import { SessionList } from './session-row.js';
import type { Session } from '../shared/policy.js';
interface AttentionState { gate:{ reason:string;attention:Session[] };settings?:{darkMode?:boolean}; }

export class PageOverlay {
  private host:HTMLDivElement|undefined;
  private dialog:HTMLElement|undefined;
  private agents:HTMLElement|undefined;
  private reason:HTMLElement|undefined;
  private agentList:SessionList|undefined;
  private body:HTMLElement|undefined;
  private bodyWasInert=false;
  private observer:MutationObserver|undefined;
  private priorFocus:HTMLElement|undefined;
  private position:{url:string;x:number;y:number}|undefined;
  private playing=new Set<HTMLMediaElement>();
  private stopPlayback=(event:Event)=>{if(this.host?.isConnected && event.target instanceof HTMLMediaElement){this.playing.add(event.target);event.target.setAttribute('data-prompt2scroll-playing','');event.target.pause();}};
  private protectBody=()=>{
    if(document.body===this.body)return;
    if(this.body){if(!this.bodyWasInert)this.body.removeAttribute('inert');this.body.removeAttribute('data-prompt2scroll-inert');}
    this.body=document.body??undefined;this.bodyWasInert=this.body?.hasAttribute('inert')??false;
    this.body?.setAttribute('data-prompt2scroll-inert',String(this.bodyWasInert));this.body?.setAttribute('inert','');
  };

  show(state?:AttentionState,reason?:string){
    if(!this.host?.isConnected){
      this.priorFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
      this.position={url:location.href,x:window.scrollX,y:window.scrollY};
      this.host=document.createElement('div');
      this.host.dataset.prompt2scrollOverlay='attention';
      this.host.style.cssText='all:initial;position:fixed;inset:0;z-index:2147483647;display:block;overflow:auto;overscroll-behavior:contain;background:var(--base,#f5f7fc);color:var(--ink,#18213c);font:14px system-ui,-apple-system,sans-serif;';
      const root=this.host.attachShadow({mode:'closed'});
      const style=document.createElement('style');style.textContent=uiCSS;root.append(style);
      this.dialog=document.createElement('main');this.dialog.className='blocked';this.dialog.tabIndex=-1;this.dialog.setAttribute('role','dialog');this.dialog.setAttribute('aria-modal','true');this.dialog.setAttribute('aria-label','Your agent needs attention');
      const panel=document.createElement('div');panel.className='attention';
      const title=document.createElement('h1');title.textContent='Your agent needs attention.';
      this.agents=document.createElement('div');this.reason=document.createElement('p');this.reason.setAttribute('role','status');
      this.agentList=new SessionList(this.agents);
      panel.append(title,this.agents,this.reason);this.dialog.append(panel);root.append(this.dialog);document.documentElement?.append(this.host);
      this.protectBody();
      this.observer=new MutationObserver(this.protectBody);this.observer.observe(document.documentElement,{childList:true});
      for(const media of document.querySelectorAll<HTMLMediaElement>('video,audio')){if((!media.paused&&!media.ended)||media.hasAttribute('data-prompt2scroll-playing')){this.playing.add(media);media.setAttribute('data-prompt2scroll-playing','');}media.pause();}
      document.addEventListener('play',this.stopPlayback,true);
      if(document.fullscreenElement && document.exitFullscreen)void document.exitFullscreen().catch(()=>{});
      this.dialog.focus({preventScroll:true});
    }
    this.host!.dataset.theme=state?.settings?.darkMode?'dark':'light';
    this.reason!.textContent=reason ?? state?.gate.reason ?? 'Checking agent status…';
    const attention=state?.gate.attention??[];
    this.reason!.hidden=attention.length>0&&!reason;
    this.agentList!.render(attention);
  }

  hide(){
    if(!this.host)return;
    document.removeEventListener('play',this.stopPlayback,true);
    this.observer?.disconnect();this.observer=undefined;
    this.host.remove();this.host=undefined;this.dialog=undefined;this.agents=undefined;this.agentList=undefined;this.reason=undefined;
    if(this.body){if(!this.bodyWasInert)this.body.removeAttribute('inert');this.body.removeAttribute('data-prompt2scroll-inert');}this.body=undefined;
    // Keep the same document, scroll position, form values and media objects.
    if(this.position?.url===location.href && (window.scrollX!==this.position.x||window.scrollY!==this.position.y))window.scrollTo({left:this.position.x,top:this.position.y,behavior:'instant'});
    if(document.hasFocus()&&this.priorFocus?.isConnected)this.priorFocus.focus({preventScroll:true});
    this.position=undefined;this.priorFocus=undefined;
    for(const media of this.playing){media.removeAttribute('data-prompt2scroll-playing');if(media.isConnected)void media.play().catch(()=>{});}
    this.playing.clear();
  }
}
