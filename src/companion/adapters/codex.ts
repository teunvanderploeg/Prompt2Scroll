import type { Session } from '../../shared/policy.js';
// Observe the same JSON-RPC messages the real CLI receives. No transcript heuristics.
export class CodexState {
  sessions = new Map<string, Session>();
  pending = new Map<string, string>();
  active = new Set<string>();
  private resolveRequest(requestId:string) {
    const id=this.pending.get(requestId);this.pending.delete(requestId);
    const session=id?this.sessions.get(id):undefined;
    if(session && session.status==='Waiting for Input' && ![...this.pending.values()].includes(id!)) {
      session.lastActivityAt=Date.now();session.status=this.active.has(id!)?'Running':'Idle';
    }
  }
  server(message: any) {
    const p = message.params ?? {}; const method = message.method ?? '';
    if(method==='serverRequest/resolved'){this.resolveRequest(String(p.requestId));return;}
    const id = p.threadId ?? p.thread?.id;
    if (!id || typeof id !== 'string') return;
    let s = this.sessions.get(id);
    if (!s) { s = { id:`codex:${id}`, agent:'Codex', name:p.thread?.name || 'Codex', task:p.thread?.preview || 'Coding session', status:'Idle', observedAt:Date.now(), shortcut:`codex resume ${id}` }; this.sessions.set(id,s); }
    if(s.lastActivityAt===undefined || Date.now()-s.lastActivityAt>=1000)s.lastActivityAt=Date.now();
    if (p.thread?.name) s.name = p.thread.name;
    if (method === 'thread/name/updated' && p.threadName) s.name = p.threadName;
    if (p.thread?.preview) s.task = p.thread.preview.slice(0,180);
    if (method === 'turn/started') { this.active.add(id); s.status = 'Running'; }
    if (method === 'turn/completed') { this.active.delete(id); s.status = p.turn?.status === 'failed' ? 'Error' : p.turn?.status === 'completed' ? 'Completed' : 'Idle'; for (const [key, thread] of this.pending) if (thread === id) this.pending.delete(key); }
    if (method === 'thread/status/changed') {
      const status = p.status;
      if (status?.type === 'active') { this.active.add(id);s.status = status.activeFlags?.some((f: string) => /waiting/i.test(f)) ? 'Waiting for Input' : 'Running'; }
      else { this.active.delete(id); s.status = status?.type === 'systemError' ? 'Error' : ['Completed','Error'].includes(s.status) ? s.status : 'Idle'; }
    }
    // Any server request pauses access, including unknown future approval methods.
    if (message.id !== undefined && message.method) { this.pending.set(String(message.id), id); s.status = 'Waiting for Input'; }
    if (method === 'error' && !p.willRetry) { this.active.delete(id); s.status = 'Error'; }
    if ([...this.pending.values()].includes(id)) s.status = 'Waiting for Input';
  }
  client(message: any) {
    if(message.method === 'turn/start') { const s=this.sessions.get(message.params?.threadId); const input=message.params?.input; if(s)s.lastActivityAt=Date.now(); if(s && Array.isArray(input)) s.task=input.filter((i:any)=>i.type==='text').map((i:any)=>i.text).join(' ').slice(0,180) || s.task; }
    if (message.method || message.id === undefined) return;
    this.resolveRequest(String(message.id));
  }
}
