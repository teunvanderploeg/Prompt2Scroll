export const DEFAULT_COUNTDOWN_SECONDS=3;
export const MAX_COUNTDOWN_SECONDS=60;
export function validCountdownSeconds(value:unknown):value is number {
  return typeof value==='number' && Number.isInteger(value) && value>=0 && value<=MAX_COUNTDOWN_SECONDS;
}
export function countdownSeconds(value:unknown):number {
  return validCountdownSeconds(value)?value:DEFAULT_COUNTDOWN_SECONDS;
}
// Anchor the deadline to the original transition, including when the setting
// changes mid-countdown. Startup and uncertain state still block immediately.
export class AttentionCountdown {
  private wasAllowed=false;
  private startedAt:number|undefined;
  update(allowed:boolean,confirmed:boolean,now=Date.now(),seconds=DEFAULT_COUNTDOWN_SECONDS):number|undefined {
    if(allowed || !confirmed)this.startedAt=undefined;
    else if(this.wasAllowed)this.startedAt=now;
    this.wasAllowed=allowed;
    if(this.startedAt===undefined)return undefined;
    const deadline=this.startedAt+countdownSeconds(seconds)*1000;
    if(now>=deadline){this.startedAt=undefined;return undefined;}
    return deadline;
  }
}
