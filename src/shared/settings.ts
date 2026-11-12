import { countdownSeconds, validCountdownSeconds } from './countdown.js';
import { normalizeDomain, type Settings } from './policy.js';

export type SettingsChanges=Partial<Settings> & {
  thread?:{id:string;watched:boolean};
  website?:{domain:string;blocked:boolean};
};

export function updateSettings(current:Settings,changes:SettingsChanges):Settings {
  if(changes.countdownSeconds!==undefined && !validCountdownSeconds(changes.countdownSeconds))throw new Error('Choose a whole number of seconds from 0 to 60.');
  for(const [key,label] of [['darkMode','Dark mode'],['anyRunning','Any running agent'],['autoOpenFinished','Auto-open finished threads']] as const){
    if(changes[key]!==undefined && typeof changes[key]!=='boolean')throw new Error(`${label} must be on or off.`);
  }
  if(changes.selected!==undefined && (!Array.isArray(changes.selected)||!changes.selected.every(id=>typeof id==='string')))throw new Error('Choose valid threads.');
  if(changes.domains!==undefined && (!Array.isArray(changes.domains)||!changes.domains.every(domain=>typeof domain==='string')))throw new Error('Choose valid website hostnames.');
  let selected=[...new Set(changes.selected??current.selected)];
  let domains=[...new Set((changes.domains??current.domains).map(normalizeDomain))];
  if(changes.thread!==undefined){
    const {id,watched}=changes.thread;
    if(typeof id!=='string'||!id||typeof watched!=='boolean')throw new Error('Choose a valid thread and monitoring state.');
    selected=watched?[...new Set([...selected,id])]:selected.filter(value=>value!==id);
  }
  if(changes.website!==undefined){
    const {domain,blocked}=changes.website;
    if(typeof domain!=='string'||typeof blocked!=='boolean')throw new Error('Choose a valid website and blocking state.');
    const value=normalizeDomain(domain);
    domains=blocked?[...new Set([...domains,value])]:domains.filter(item=>item!==value);
  }
  return {
    countdownSeconds:countdownSeconds(changes.countdownSeconds??current.countdownSeconds),
    darkMode:changes.darkMode??current.darkMode??false,
    anyRunning:changes.anyRunning??current.anyRunning??false,
    autoOpenFinished:changes.autoOpenFinished??current.autoOpenFinished??false,
    selected,domains,
  };
}
