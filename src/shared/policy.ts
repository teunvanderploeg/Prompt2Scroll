import { DEFAULT_COUNTDOWN_SECONDS } from './countdown.js';
export type Status = 'Running' | 'Waiting for Input' | 'Completed' | 'Error' | 'Idle';
export interface Session { id: string; agent: string; name: string; task: string; status: Status; observedAt: number; lastActivityAt?: number; detail?: string; uncertainReason?: string; openUrl?: string; shortcut: string; }
export interface Snapshot { sessions: Session[]; at: number; diagnostics: string[]; }
export interface Settings { selected: string[]; domains: string[]; countdownSeconds?: number; darkMode?: boolean; anyRunning?: boolean; autoOpenFinished?: boolean; }
export const DEFAULTS: Settings = { countdownSeconds:DEFAULT_COUNTDOWN_SECONDS, darkMode:false, anyRunning:false, autoOpenFinished:false, selected: [], domains: ['x.com','twitter.com','reddit.com','youtube.com','youtu.be','instagram.com'] };
export const LEASE_MS = 6000;
export function missingSession(id:string, previous?:Session, reason='Session is not available from its agent.'):Session {
  const agent=id.startsWith('t3:')?'T3 Code':id.startsWith('codex:')?'Codex':id.startsWith('opencode:')?'OpenCode':'Agent';
  return {...previous,id,agent:previous?.agent??agent,name:previous?.name??agent,task:previous?.task??'Session unavailable',status:previous?.status??'Idle',observedAt:previous?.observedAt??0,shortcut:previous?.shortcut??'',uncertainReason:reason};
}
export function fresh(at: number, now = Date.now(), ttl = LEASE_MS) { return Number.isFinite(at) && at <= now + 1000 && now - at < ttl; }
export function isRunning(session:Session,now=Date.now()){return session.status==='Running'&&!session.uncertainReason&&fresh(session.observedAt,now);}
export function gate(settings: Settings, snapshot?: Snapshot, connected = false, now = Date.now()) {
  if (!settings.anyRunning && !settings.selected.length) return { allowed: true, reason: 'No threads are being monitored.', attention: [] as Session[] };
  if (!connected || !snapshot || !fresh(snapshot.at, now)) return { allowed: false, reason: 'Companion disconnected. Sites stay blocked.', attention: settings.selected.map(id=>missingSession(id,snapshot?.sessions.find(s=>s.id===id),'Connection to the companion was lost.')) };
  if(settings.anyRunning){
    const allowed=snapshot.sessions.some(session=>isRunning(session,now));
    const attention=allowed?[]:[...snapshot.sessions].sort((a,b)=>(b.lastActivityAt||0)-(a.lastActivityAt||0)).slice(0,3);
    return {allowed,reason:allowed?'An agent is running.':'No agent is running.',attention};
  }
  const attention = settings.selected.map(id => snapshot.sessions.find(s => s.id === id) ?? missingSession(id)).filter(s => s.status !== 'Running' || s.uncertainReason || !fresh(s.observedAt, now));
  return { allowed: !attention.length, reason: attention.length ? 'Your agent needs attention. Check the results.' : 'All selected agents are running.', attention };
}
export function normalizeDomain(value: string): string {
  const input = value.trim().toLowerCase();
  if (!input || /[\s*]/.test(input)) throw new Error('Enter a hostname, such as reddit.com.');
  const url = new URL(input.includes('://') ? input : `https://${input}`);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !url.hostname.includes('.')) throw new Error('Enter a hostname, such as reddit.com.');
  return url.hostname.replace(/\.$/, '');
}
export function matches(url: string, domains: string[]) { try { const u = new URL(url); const hostname=u.hostname.replace(/\.$/,'');return ['https:','http:'].includes(u.protocol) && domains.some(d => hostname === d || hostname.endsWith(`.${d}`)); } catch { return false; } }
