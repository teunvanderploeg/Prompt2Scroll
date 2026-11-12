import type {Session} from './policy.js';

export function sessionURL(s:Session):string|undefined{
  if(!s.openUrl)return;
  try{
    const url=new URL(s.openUrl);
    if(url.username||url.password||url.search||url.hash||url.port)return;
    if(s.agent==='T3 Code'&&s.id.startsWith('t3:')&&['t3code:','t3code-dev:'].includes(url.protocol)&&url.hostname==='threads'){
      const parts=url.pathname.split('/');
      if(parts.length===3&&/^[a-f0-9-]{36}$/i.test(parts[1])&&parts[2]===s.id.slice(3)&&/^[a-f0-9-]{36}$/i.test(parts[2]))return url.href;
    }
  }catch{ /* Unsupported links fall back to copying the session shortcut. */ }
}
