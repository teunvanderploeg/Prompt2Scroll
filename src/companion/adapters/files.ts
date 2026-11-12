import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RUNTIME } from '../paths.js';
import type { Adapter } from './types.js';
import type { Session } from '../../shared/policy.js';
export class FileAdapter implements Adapter {
  name = 'Codex';
  async poll(): Promise<Session[]> {
    const files = await readdir(RUNTIME).catch(() => []);
    const sessions: Session[] = [];
    for (const f of files.filter(f => f.endsWith('.json'))) {
      try {
        const x = JSON.parse(await readFile(join(RUNTIME,f),'utf8'));
        const alive = Number.isInteger(x.pid) && (() => { try { process.kill(x.pid,0); return true; } catch { return false; } })();
        for (const s of x.sessions ?? []) sessions.push({ ...s, observedAt: x.at, ...(alive ? {} : { status:'Error', detail:'Agent process stopped' }) });
      } catch { /* A missing/malformed session cannot grant access. */ }
    }
    // A resumed thread can have an older, dead writer. Prefer the freshest observation.
    return [...new Map(sessions.sort((a,b) => a.observedAt-b.observedAt).map(s => [s.id,s])).values()];
  }
}
