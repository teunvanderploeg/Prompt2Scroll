import type { Session } from '../../shared/policy.js';
export interface Adapter { name: string; poll(selected?:readonly string[]): Promise<Session[]>; }
