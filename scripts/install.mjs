import { mkdir, readFile, writeFile, rename, cp, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

export async function installCompanion({sourceRoot = root, home = homedir(), platform = process.platform, nodePath = process.execPath, env = process.env} = {}) {
  if (!['darwin', 'linux'].includes(platform)) throw new Error('The installer supports macOS and Linux.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('Install Node.js 22.13 or newer from https://nodejs.org, then run the installer again.');
  await import('node:sqlite');
  // Check the payload before changing an existing installation.
  for (const file of ['companion/host.js', 'companion/codex-launch.js', 'companion/THIRD_PARTY_NOTICES.txt', 'extension/manifest.json']) {
    await access(join(sourceRoot, 'dist', file));
  }
  const data = resolve(env.P2S_HOME || join(home, '.prompt2scroll'));
  const app = join(data, 'app');
  const extension = join(data, 'extension');
  await mkdir(data, {recursive: true, mode: 0o700});
  await mkdir(app, {recursive: true, mode: 0o700});
  async function put(path, contents, mode = 0o600) {
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, contents, {mode});
    await rename(temporary, path);
  }
  // Replacing files atomically leaves a running companion intact during updates.
  for (const file of ['host.js', 'codex-launch.js', 'THIRD_PARTY_NOTICES.txt']) {
    await put(join(app, file), await readFile(join(sourceRoot, 'dist/companion', file)));
  }
  await put(join(app, 'package.json'), '{"private":true,"type":"module"}\n');
  await cp(join(sourceRoot, 'dist/extension'), extension, {recursive: true});
  const searchPath = [env.PATH || '', join(home, '.local/bin'), join(home, '.opencode/bin'), join(home, '.bun/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':');
  const exports = [`export PATH=${quote(searchPath)}`, `export P2S_HOME=${quote(data)}`];
  for (const key of ['P2S_CODEX', 'P2S_OPENCODE', 'P2S_T3_DB']) {
    if (env[key]) exports.push(`export ${key}=${quote(env[key])}`);
  }
  const header = `#!/bin/sh\n${exports.join('\n')}\n`;
  const wrapper = join(data, 'native-host');
  await put(wrapper, `${header}exec ${quote(nodePath)} ${quote(join(app, 'host.js'))} "$@"\n`, 0o700);
  await put(join(data, 'codex'), `${header}exec ${quote(nodePath)} ${quote(join(app, 'codex-launch.js'))} "$@"\n`, 0o700);
  await put(join(data, 'inspect'), `${header}exec ${quote(nodePath)} ${quote(join(app, 'host.js'))} --inspect\n`, 0o700);
  const manifestDirectory = platform === 'darwin'
    ? join(home, 'Library/Application Support/Mozilla/NativeMessagingHosts')
    : join(home, '.mozilla/native-messaging-hosts');
  await mkdir(manifestDirectory, {recursive: true});
  const manifest = join(manifestDirectory, 'local.prompt2scroll.json');
  await put(manifest, JSON.stringify({name: 'local.prompt2scroll', description: 'Local agent status monitor', path: wrapper, type: 'stdio', allowed_extensions: ['prompt2scroll@local']}, null, 2) + '\n');
  let xpi;
  try { await access(join(sourceRoot, 'dist/prompt2scroll.xpi')); xpi = join(data, 'prompt2scroll.xpi'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (xpi) await put(xpi, await readFile(join(sourceRoot, 'dist/prompt2scroll.xpi')));
  return {data, manifest, extension, xpi};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--home')) throw new Error('Usage: node scripts/install.mjs [--home /path/to/user-home]');
    const result = await installCompanion({home: args[1] || homedir()});
    console.log('\nPrompt2Scroll companion installed.\n');
    if (result.xpi) {
      console.log('In Firefox: open about:addons, choose the gear menu, then Install Add-on From File.');
      console.log(`Choose: ${result.xpi}`);
    } else {
      console.log('In Firefox: open about:debugging#/runtime/this-firefox');
      console.log('Choose Load Temporary Add-on and select:');
      console.log(join(result.extension, 'manifest.json'));
      console.log('\nThis preview must be loaded again after Firefox restarts.');
    }
    console.log(`\nCodex: ${quote(join(result.data, 'codex'))} -C /path/to/project`);
    console.log('T3 Code and OpenCode appear automatically.\n');
  } catch (error) {
    console.error(`\nInstallation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
