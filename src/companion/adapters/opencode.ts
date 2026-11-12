import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Adapter } from './types.js';
import type { Session, Status } from '../../shared/policy.js';
const exec = promisify(execFile);
export async function api(path: string, params: Record<string,string> = {}) {
  const { stdout } = await exec(process.env.P2S_OPENCODE || 'opencode', ['api','GET',path,...Object.entries(params).flatMap(([k,v]) => ['--param',`${k}=${v}`])], { timeout:2500, maxBuffer:4*1024*1024 });
  return JSON.parse(stdout);
}
export function openCodeStatus(active: any, pending: boolean, outcome?: string): Status {
  if (pending) return 'Waiting for Input';
  if (active?.type === 'running') return 'Running';
  if (active?.type === 'retry') return 'Idle';
  if (active) return 'Idle';
  return outcome === 'failed' ? 'Error' : outcome === 'succeeded' ? 'Completed' : 'Idle';
}
export class OpenCodeAdapter implements Adapter {
  name = 'OpenCode';
  async poll(selected:readonly string[]=[]): Promise<Session[]> {
    const [page, active] = await Promise.all([api('/api/session',{limit:'100'}), api('/api/session/active')]);
    if (!Array.isArray(page.data) || !active.data || typeof active.data !== 'object') throw new Error('Unsupported OpenCode API. Requires v2.');
    const byId = new Map<string,any>(page.data.map((s:any) => [s.id,s]));
    for (const id of Object.keys(active.data)) if (!byId.has(id)) byId.set(id, (await api(`/api/session/${encodeURIComponent(id)}`)).data);
    for(const selectedId of selected.filter(id=>id.startsWith('opencode:'))){
      const id=selectedId.slice(9);if(byId.has(id))continue;
      try{const session=(await api(`/api/session/${encodeURIComponent(id)}`)).data;if(session?.id===id)byId.set(id,session);}catch{ /* An unavailable selected session stays blocked. */ }
    }
    const locations = new Map<string,any>();
    for (const s of byId.values()) if (active.data[s.id]) locations.set(JSON.stringify(s.location),s.location);
    const waiting = new Set<string>();
    // Permission/form reads are scoped to each active session's real location.
    await Promise.all([...locations].map(async ([key]) => {
      const [permissions,forms] = await Promise.all([api('/api/permission/request',{'location[directory]':JSON.parse(key).directory}),api('/api/form',{'location[directory]':JSON.parse(key).directory})]);
      if (!Array.isArray(permissions.data) || !Array.isArray(forms.data)) throw new Error('Unknown input request format');
      for (const r of [...permissions.data,...forms.data]) { if (typeof r.sessionID !== 'string') throw new Error('Unknown input request owner'); waiting.add(r.sessionID); }
    }));
    const now = Date.now();
    return [...byId.values()].map(s => ({ id:`opencode:${s.id}`, agent:'OpenCode', name:s.agent || 'OpenCode', task:s.title || 'Coding session', status:openCodeStatus(active.data[s.id],waiting.has(s.id),s.outcome), observedAt:now, lastActivityAt:s.time?.updated, shortcut:`opencode --session ${s.id}` }));
  }
}
