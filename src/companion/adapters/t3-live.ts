import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
const exec = promisify(execFile);
export interface T3Runtime { version: number; pid: number; port: number; startedAt: string; }
export interface T3Owner { startedAt: number; openScheme?:'t3code'|'t3code-dev'; }

export function validRuntime(value: T3Runtime): boolean {
  return value?.version === 1 && Number.isInteger(value.pid) && value.pid > 0 && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535 && Number.isFinite(Date.parse(value.startedAt));
}
export function ownsDatabaseAndPort(files: string, database: string, port: number): boolean {
  const names = files.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
  return names.includes(resolve(database)) && names.some(name => name.endsWith(`:${port}`) || name.endsWith(`:${port} (LISTEN)`));
}

// Persisted activity timestamps describe changes, not heartbeats. Confirm the
// live owner and its HTTP event loop before renewing an observation of its state.
export async function probeT3Owner(database: string): Promise<T3Owner> {
  const runtime: T3Runtime = JSON.parse(await readFile(join(dirname(database),'server-runtime.json'),'utf8'));
  if (!validRuntime(runtime)) throw new Error('Invalid T3 runtime identity');
  process.kill(runtime.pid,0);
  const { stdout } = await exec('lsof',['-nP','-a','-p',String(runtime.pid),'-Fn'],{timeout:1500,maxBuffer:2*1024*1024});
  if (!ownsDatabaseAndPort(stdout,database,runtime.port)) throw new Error('T3 no longer owns this database and port');
  // Always probe loopback, regardless of the host/origin in the runtime file.
  const response = await fetch(`http://127.0.0.1:${runtime.port}/`,{signal:AbortSignal.timeout(1500),redirect:'error'});
  await response.body?.cancel();
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('T3 server is not ready');
  // A restart during the probe invalidates this observation.
  const after: T3Runtime = JSON.parse(await readFile(join(dirname(database),'server-runtime.json'),'utf8'));
  if (after.pid !== runtime.pid || after.startedAt !== runtime.startedAt || after.port !== runtime.port) throw new Error('T3 server restarted');
  const desktop=process.platform==='darwin'&&['/Applications',join(homedir(),'Applications')].some(directory=>['T3 Code.app','T3 Code (Beta).app'].some(name=>existsSync(join(directory,name))));
  return { startedAt:Date.parse(runtime.startedAt),...(desktop?{openScheme:'t3code' as const}:{}) };
}
