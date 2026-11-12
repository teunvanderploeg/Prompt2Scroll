import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Adapter } from './types.js';
import type { Session, Status } from '../../shared/policy.js';
import { probeT3Owner, type T3Owner } from './t3-live.js';
export function t3Status(status: string, pending: number): Status {
  if (pending > 0) return 'Waiting for Input';
  return status === 'running' ? 'Running' : status === 'completed' ? 'Completed' : status === 'failed' ? 'Error' : 'Idle';
}
export class T3Adapter implements Adapter {
  name = 'T3 Code';
  constructor(
    private database = process.env.P2S_T3_DB || join(homedir(),'.t3/userdata/statev2.sqlite'),
    private probe: (database: string) => Promise<T3Owner> = probeT3Owner,
  ) {}
  async poll(selected:readonly string[]=[]): Promise<Session[]> {
    const owner = await this.probe(this.database);
    const environmentId=await readFile(join(dirname(this.database),'environment-id'),'utf8').then(value=>value.trim()).catch(()=>'');
    const db = new DatabaseSync(this.database, { readOnly:true });
    try {
      db.exec('PRAGMA busy_timeout=100;');
      const rows = db.prepare(`WITH recent AS (SELECT thread_id FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 100)
        SELECT t.thread_id,t.title,COALESCE((SELECT max(p.updated_at) FROM orchestration_v2_projection_provider_threads p WHERE p.thread_id=t.thread_id),t.updated_at) AS last_activity,COALESCE(r.status,u.status) AS status,
        (SELECT count(*) FROM orchestration_v2_projection_runtime_requests q WHERE q.thread_id=t.thread_id AND q.status='pending') AS pending,
        (SELECT max(p.updated_at) FROM orchestration_v2_projection_provider_threads p WHERE p.thread_id=t.thread_id AND p.status='active') AS seen
        FROM orchestration_v2_projection_threads t LEFT JOIN orchestration_v2_projection_runs r
        ON r.run_id=(SELECT r2.run_id FROM orchestration_v2_projection_runs r2 WHERE r2.thread_id=t.thread_id ORDER BY (r2.status='running') DESC,r2.ordinal DESC LIMIT 1)
        LEFT JOIN orchestration_v2_projection_provider_turns u
        ON u.provider_turn_id=(SELECT u2.provider_turn_id FROM orchestration_v2_projection_provider_turns u2 WHERE u2.provider_thread_id=t.active_provider_thread_id ORDER BY u2.ordinal DESC LIMIT 1)
        WHERE t.deleted_at IS NULL AND (t.thread_id IN (SELECT thread_id FROM recent) OR t.thread_id IN (SELECT value FROM json_each(?)) OR r.status='running' OR (r.status IS NULL AND u.status='running')) ORDER BY t.updated_at DESC`).all(JSON.stringify(selected.filter(id=>id.startsWith('t3:')).map(id=>id.slice(3)))) as any[];
      return rows.map(r => {
        const uncertain=r.status === 'running' && !(Date.parse(r.seen ?? '') >= owner.startedAt);
        return { id:`t3:${r.thread_id}`, agent:'T3 Code', name:'T3 Code', task:r.title, status:t3Status(r.status,r.pending), observedAt:uncertain?0:Date.now(), lastActivityAt:Date.parse(r.last_activity), shortcut:r.title,
          ...(owner.openScheme&&/^[a-f0-9-]{36}$/i.test(environmentId)&&/^[a-f0-9-]{36}$/i.test(r.thread_id)?{openUrl:`${owner.openScheme}://threads/${environmentId}/${r.thread_id}`} : {}),
          detail:uncertain?'Running state belongs to an earlier T3 server. Waiting for a current observation.':r.pending>0?'T3 is waiting for approval or input.':'Confirmed by the live T3 server.' };
      });
    } finally { db.close(); }
  }
}
