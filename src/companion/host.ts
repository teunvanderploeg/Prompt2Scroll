import { FileAdapter } from './adapters/files.js';
import { OpenCodeAdapter } from './adapters/opencode.js';
import { T3Adapter } from './adapters/t3.js';
import type { Adapter } from './adapters/types.js';
import type { Session, Snapshot } from '../shared/policy.js';
import { frame, Decoder } from './framing.js';
import { openSession } from './open-session.js';
const adapters: Adapter[] = [new FileAdapter(),new OpenCodeAdapter(),new T3Adapter()];
const results = new Map<string,Session[]>(); const errors = new Map<string,string>();
let selected:string[]=[];
function snapshot(): Snapshot { return { at:Date.now(),sessions:[...results.values()].flat(),diagnostics:[...errors.values()] }; }
async function poll(adapter: Adapter) {
  try { results.set(adapter.name, await adapter.poll(selected)); errors.delete(adapter.name); }
  catch(error) { results.set(adapter.name,[]);const reason=error instanceof Error?error.message.split('\n')[0].slice(0,180):'Status check failed';errors.set(adapter.name,`${adapter.name}: ${reason}`); }
}
if (process.argv.includes('--inspect')) {
  await Promise.all(adapters.map(poll)); console.log(JSON.stringify(snapshot(),null,2));
} else {
  for (const adapter of adapters) void (async () => { while(true) { await poll(adapter); await new Promise(r => setTimeout(r,1000)); } })();
  const decoder = new Decoder();
  process.stdin.on('data',chunk => { try {
    for(const value of decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))){
      const message=value as {type?:string;selected?:unknown;id?:unknown;requestId?:unknown};
      if(message.type==='watch'&&Array.isArray(message.selected)&&message.selected.length<=5000&&message.selected.every(id=>typeof id==='string'))selected=[...new Set<string>(message.selected)];
      if(message.type==='open-session'&&typeof message.id==='string'&&typeof message.requestId==='string'&&message.requestId.length<=100){
        const session=[...results.values()].flat().find(s=>s.id===message.id);
        void (async()=>{
          try{if(!session)throw new Error('Session unavailable');await openSession(session);process.stdout.write(frame({type:'open-result',requestId:message.requestId,ok:true}));}
          catch{process.stdout.write(frame({type:'open-result',requestId:message.requestId,ok:false,error:'Could not open the agent. Check that its app is available.'}));}
        })();
      }
    }
  } catch { process.exit(1); } });
  process.stdin.on('end',()=>process.exit(0));
  setInterval(() => { if (!process.stdout.writableNeedDrain) process.stdout.write(frame(snapshot())); },1000);
}
