import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { RUNTIME } from './paths.js';
import { CodexState } from './adapters/codex.js';
mkdirSync(RUNTIME,{recursive:true,mode:0o700});
const state = new CodexState();
const file = join(RUNTIME,`${randomUUID()}.json`);
const binary = process.env.P2S_CODEX || 'codex';
const secret = randomUUID();
const wss = new WebSocketServer({host:'127.0.0.1',port:0,verifyClient: (info: { origin: string; req: import('node:http').IncomingMessage }) => !info.origin && info.req.headers.authorization === `Bearer ${secret}`});
await new Promise<void>(resolve => wss.once('listening',resolve));
const addr = wss.address(); if (typeof addr === 'string' || !addr) throw new Error('Could not start monitor');
let app: ReturnType<typeof spawn> | undefined;
let connection: import('ws').WebSocket | undefined;
let lastState='';
function persist(force=false) {
  const next=JSON.stringify([...state.sessions.values()]);
  if(!force && next===lastState)return;
  lastState=next;
  writeFileSync(`${file}.tmp`,JSON.stringify({pid:process.pid,at:Date.now(),sessions:[...state.sessions.values()]}),{mode:0o600});
  renameSync(`${file}.tmp`,file);
}
wss.on('connection',ws => {
  if (connection) { ws.close(); return; } connection = ws;
  app = spawn(binary,['app-server','--listen','stdio://'],{stdio:['pipe','pipe','inherit']});
  const lines = createInterface({input:app.stdout!});
  lines.on('line',line => { try { state.server(JSON.parse(line)); persist(); } catch { for (const s of state.sessions.values()) s.status='Idle'; persist(); } if (ws.readyState === ws.OPEN) ws.send(line); });
  ws.on('message',data => { try { state.client(JSON.parse(data.toString())); persist(); } catch {} app?.stdin?.write(`${data.toString()}\n`); });
  ws.on('close',() => { for (const s of state.sessions.values()) s.status='Error'; persist(); app?.kill(); });
  app.on('error',error => { console.error(error.message); ws.close(); });
  app.on('exit',() => { for (const s of state.sessions.values()) s.status='Error'; persist(); ws.close(); });
});
const timer = setInterval(()=>persist(true),1000);
const cli = spawn(binary,['--remote',`ws://127.0.0.1:${addr.port}`,'--remote-auth-token-env','P2S_MONITOR_TOKEN',...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,P2S_MONITOR_TOKEN:secret}});
let ended=false;
function finish(code:number) { if (ended) return; ended=true; clearInterval(timer); app?.kill(); cli.kill(); for (const s of state.sessions.values()) if(s.status==='Running'||s.status==='Waiting for Input') s.status='Idle'; persist(); wss.close(); process.exit(code); }
cli.on('exit',code => finish(code ?? 1)); cli.on('error',e => { console.error(e.message); finish(1); });
process.on('SIGINT',()=>finish(130)); process.on('SIGTERM',()=>finish(143));
