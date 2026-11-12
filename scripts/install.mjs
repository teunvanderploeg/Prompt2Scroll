import { mkdir,writeFile,chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve,join } from 'node:path';
if (!['linux','darwin'].includes(process.platform)) throw new Error('MVP installer supports macOS and Linux. See README for Windows.');
const data = join(homedir(),'.prompt2scroll'); await mkdir(data,{recursive:true,mode:0o700});
const wrapper = join(data,'native-host');
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
// Firefox does not inherit the terminal's nvm or agent PATH.
await writeFile(wrapper,`#!/bin/sh\nexport PATH=${quote(process.env.PATH || '')}\nexec ${quote(process.execPath)} ${quote(resolve('dist/companion/host.js'))}\n`);
await chmod(wrapper,0o700);
const dir = process.platform==='darwin' ? join(homedir(),'Library/Application Support/Mozilla/NativeMessagingHosts') : join(homedir(),'.mozilla/native-messaging-hosts');
await mkdir(dir,{recursive:true});
await writeFile(join(dir,'local.prompt2scroll.json'),JSON.stringify({name:'local.prompt2scroll',description:'Local agent status monitor',path:wrapper,type:'stdio',allowed_extensions:['prompt2scroll@local']},null,2));
console.log('Native host registered. Load dist/extension/manifest.json in Firefox about:debugging.');
