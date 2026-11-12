import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RUNTIME } from '../paths.js';
import type { Adapter } from './types.js';
import type { Session } from '../../shared/policy.js';
export class FileAdapter implements Adapter {
  name = 'Codex';
  constructor(private directory=RUNTIME) {}
  async poll(): Promise<Session[]> {
    const files = await readdir(this.directory).catch(() => []);
    const sessions = new Map<string,{session:Session;firstObservedAt:number}>();
    for (const f of files.filter(f => f.endsWith('.json')).sort()) {
      try {
        const x = JSON.parse(await readFile(join(this.directory,f),'utf8'));
        const alive = Number.isInteger(x.pid) && (() => { try { process.kill(x.pid,0); return true; } catch { return false; } })();
        for (const s of x.sessions ?? []) {
          if(!Number.isFinite(s.observedAt))continue;
          // The session's original observation identifies its monitor. File
          // heartbeats renew freshness but must never let an older monitor win.
          const previous=sessions.get(s.id);
          if(!previous || s.observedAt>previous.firstObservedAt)sessions.set(s.id,{firstObservedAt:s.observedAt,session:{...s,observedAt:x.at,...(alive?{}:{status:'Error',detail:'Agent process stopped'})}});
        }
      } catch { /* A missing/malformed session cannot grant access. */ }
    }
    return [...sessions.values()].map(value=>value.session);
  }
}
