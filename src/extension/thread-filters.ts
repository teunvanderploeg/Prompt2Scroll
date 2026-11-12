import { fresh, type Session } from '../shared/policy.js';
export interface ThreadFilters { query: string; agent: string; status: string; oldestAt?: number; newestAt?: number; }
export function filterThreads(sessions: Session[], selected: string[], filters: ThreadFilters, now=Date.now()): Session[] {
  const words=filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter(s=>{
    if(filters.oldestAt!==undefined || filters.newestAt!==undefined){
      if(typeof s.lastActivityAt!=='number' || !Number.isFinite(s.lastActivityAt))return false;
      if(filters.oldestAt!==undefined && s.lastActivityAt<filters.oldestAt)return false;
      if(filters.newestAt!==undefined && s.lastActivityAt>filters.newestAt)return false;
    }
    if(filters.agent && s.agent!==filters.agent)return false;
    const text=`${s.task} ${s.name} ${s.agent} ${s.id}`.toLocaleLowerCase();
    if(!words.every(word=>text.includes(word)))return false;
    const running=s.status==='Running' && fresh(s.observedAt,now);
    switch(filters.status){
      case 'selected':return selected.includes(s.id);
      case 'running':return running;
      case 'attention':return !running;
      case 'waiting':return s.status==='Waiting for Input';
      case 'completed':return s.status==='Completed';
      case 'error':return s.status==='Error';
      case 'idle':return s.status==='Idle';
      default:return true;
    }
  });
}

export interface ActivityFilter { period:string; oldest:string; newest:string; }
export const DEFAULT_ACTIVITY:ActivityFilter={period:'any',oldest:'',newest:''};
export function activityBounds(filter:ActivityFilter,now=Date.now()):{oldestAt?:number;newestAt?:number;error?:string}{
  const durations:Record<string,number>={hour:3600000,day:86400000,week:7*86400000,month:30*86400000};
  if(Object.hasOwn(durations,filter.period))return {oldestAt:now-durations[filter.period],newestAt:now};
  if(filter.period!=='custom')return {};
  const oldestAt=filter.oldest?new Date(filter.oldest).getTime():undefined;
  // The picker has minute precision; include the whole newest minute.
  const newestAt=filter.newest?new Date(filter.newest).getTime()+59999:undefined;
  if((oldestAt!==undefined&&!Number.isFinite(oldestAt))||(newestAt!==undefined&&!Number.isFinite(newestAt)))return {error:'Enter a valid date and time.'};
  if(oldestAt!==undefined&&newestAt!==undefined&&oldestAt>newestAt)return {error:'Oldest activity must be before newest activity.'};
  return {oldestAt,newestAt};
}
