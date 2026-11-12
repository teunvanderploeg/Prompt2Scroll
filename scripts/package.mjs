import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const directory = `dist/releases/${version}`;
await mkdir(directory, { recursive: true });
execFileSync('npm', ['exec', '--', 'web-ext', 'build', '--source-dir', 'dist/extension', '--artifacts-dir', directory, '--overwrite-dest'], { stdio: 'inherit' });
