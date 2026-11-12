import { homedir } from 'node:os';
import { join } from 'node:path';
export const DATA = process.env.P2S_HOME || join(homedir(), '.prompt2scroll');
export const RUNTIME = join(DATA, 'sessions');
