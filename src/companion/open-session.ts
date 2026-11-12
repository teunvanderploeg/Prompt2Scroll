import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sessionURL} from '../shared/session-link.js';
import type {Session} from '../shared/policy.js';
const exec=promisify(execFile);
type Execute=(command:string,args:string[])=>Promise<unknown>;
const execute:Execute=(command,args)=>exec(command,args,{timeout:5000,maxBuffer:16*1024});

// Open only a known session's validated app link. Never execute a shell command
// or accept an arbitrary URL from a website or extension message.
export async function openSession(session:Session,run:Execute=execute,platform:string=process.platform){
 const url=sessionURL(session);
 if(!url)throw new Error('This session does not support direct opening.');
 if(platform==='darwin')await run('/usr/bin/open',[url]);
 else if(platform==='linux')await run('xdg-open',[url]);
 else throw new Error('Opening sessions is not supported on this platform.');
}
