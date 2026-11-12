import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, stat, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {installCompanion} from '../scripts/install.mjs';
import {buildRelease} from '../scripts/release.mjs';
import {Decoder, frame} from '../src/companion/framing.ts';
import {spawn} from 'node:child_process';

const exec = promisify(execFile);

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), "prompt2scroll install's "));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const sourceRoot = join(temporary, 'download');
  const home = join(temporary, 'user');
  for (const directory of ['companion', 'extension']) await mkdir(join(sourceRoot, 'dist', directory), {recursive: true});
  await writeFile(join(sourceRoot, 'dist/companion/host.js'), 'console.log(JSON.stringify({args:process.argv.slice(2),data:process.env.P2S_HOME}));');
  await writeFile(join(sourceRoot, 'dist/companion/codex-launch.js'), 'console.log(JSON.stringify(process.argv.slice(2)));');
  await writeFile(join(sourceRoot, 'dist/companion/THIRD_PARTY_NOTICES.txt'), 'License fixture');
  await writeFile(join(sourceRoot, 'dist/extension/manifest.json'), '{}');
  const options = {sourceRoot, home, env: {PATH: process.env.PATH}, platform: 'darwin'};
  return {sourceRoot, home, options};
}

test('installed app survives removal of the download and safely passes Codex arguments', async t => {
  const {sourceRoot, home, options} = await fixture(t);
  const installed = await installCompanion(options);
  const manifest = JSON.parse(await readFile(installed.manifest, 'utf8'));
  assert.deepEqual(manifest.allowed_extensions, ['prompt2scroll@local']);
  assert.equal(manifest.path, join(home, '.prompt2scroll/native-host'));
  assert.ok(installed.manifest.includes('Library/Application Support/Mozilla/NativeMessagingHosts'));
  assert.equal((await stat(manifest.path)).mode & 0o777, 0o700);
  await rm(sourceRoot, {recursive: true});
  const snapshot = JSON.parse((await exec(manifest.path)).stdout);
  assert.equal(snapshot.data, installed.data);
  const args = ['-C', '/project with spaces', '$(touch never-run)', '`touch never-run`'];
  assert.deepEqual(JSON.parse((await exec(join(installed.data, 'codex'), args)).stdout), args);
  assert.deepEqual(JSON.parse((await exec(join(installed.data, 'inspect'))).stdout).args, ['--inspect']);
  await access(join(installed.extension, 'manifest.json'));
});

test('Linux registration, repeat install and custom data path preserve session files', async t => {
  const {sourceRoot, home, options} = await fixture(t);
  options.platform = 'linux';
  options.env.P2S_HOME = join(home, 'custom data');
  const first = await installCompanion(options);
  assert.ok(first.manifest.includes('.mozilla/native-messaging-hosts'));
  await mkdir(join(first.data, 'sessions'));
  await writeFile(join(first.data, 'sessions/existing.json'), 'keep');
  await writeFile(join(sourceRoot, 'dist/companion/host.js'), 'console.log("updated");');
  await writeFile(join(sourceRoot, 'dist/prompt2scroll.xpi'), 'fixture');
  const second = await installCompanion(options);
  assert.equal((await exec(join(second.data, 'native-host'))).stdout.trim(), 'updated');
  assert.equal(await readFile(join(second.data, 'sessions/existing.json'), 'utf8'), 'keep');
  assert.equal(await readFile(second.xpi, 'utf8'), 'fixture');
  await assert.rejects(installCompanion({...options, platform: 'win32'}), /macOS and Linux/);
});

test('incomplete downloads leave an existing companion unchanged', async t => {
  const {sourceRoot, options} = await fixture(t);
  const installed = await installCompanion(options);
  const before = await readFile(join(installed.data, 'app/host.js'), 'utf8');
  await writeFile(join(sourceRoot, 'dist/companion/host.js'), 'bad update');
  await rm(join(sourceRoot, 'dist/companion/codex-launch.js'));
  await assert.rejects(installCompanion(options), /ENOENT/);
  assert.equal(await readFile(join(installed.data, 'app/host.js'), 'utf8'), before);
});

test('release runs from an extracted download without node_modules or source', async t => {
  const temporary = await mkdtemp(join(tmpdir(), "prompt2scroll release's "));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const archive = await buildRelease();
  await exec('unzip', ['-q', archive, '-d', temporary]);
  const folder = join(temporary, archive.split('/').at(-1).replace(/\.zip$/, ''));
  await assert.rejects(access(join(folder, 'node_modules')));
  await assert.rejects(access(join(folder, 'src')));
  const data = join(temporary, 'installed');
  const {stdout} = await exec('/bin/sh', [join(folder, 'install.sh'), '--home', join(temporary, 'home')], {cwd: tmpdir(), env: {...process.env, P2S_HOME: data}});
  assert.match(stdout, /companion installed/);
  assert.equal((await stat(join(folder, 'Install.command'))).mode & 0o111, 0o111);
  await rm(folder, {recursive: true});
  const child = spawn(join(data, 'native-host'), [], {env: {...process.env, P2S_OPENCODE: '/missing/opencode', P2S_T3_DB: '/missing/t3'}});
  t.after(() => child.kill());
  const snapshot = await new Promise((resolve, reject) => {
    const decoder = new Decoder();
    const timer = setTimeout(() => reject(new Error('Installed companion did not respond')), 5000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', bytes => {
      const messages = decoder.push(bytes);
      if (messages.length) {clearTimeout(timer); resolve(messages[0]);}
    });
    child.stdin.write(frame({type: 'hello'}));
  });
  assert.ok(Array.isArray(snapshot.sessions));
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.stdin.end();
  assert.equal(await exited, 0);
  // A fake Codex executable confirms the bundled ws proxy starts without npm.
  const fakeCodex = join(temporary, 'fake-codex');
  await writeFile(fakeCodex, '#!/bin/sh\nexit 0\n', {mode: 0o700});
  await exec(join(data, 'codex'), ['-C', '/project'], {env: {...process.env, P2S_CODEX: fakeCodex}, timeout: 5000});
});

test('release rejects unsigned and mismatched XPIs instead of presenting them as permanent installs', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'prompt2scroll-xpi-'));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const manifest = JSON.parse(await readFile(new URL('../src/extension/manifest.json', import.meta.url), 'utf8'));
  await writeFile(join(temporary, 'manifest.json'), JSON.stringify(manifest));
  const unsigned = join(temporary, 'unsigned.xpi');
  await exec('zip', ['-q', unsigned, 'manifest.json'], {cwd: temporary});
  await assert.rejects(buildRelease({xpi: unsigned}), /no Mozilla signature/);
  await writeFile(join(temporary, 'manifest.json'), JSON.stringify({...manifest, version: '0.0.0'}));
  const mismatch = join(temporary, 'wrong-version.xpi');
  await exec('zip', ['-q', mismatch, 'manifest.json'], {cwd: temporary});
  await assert.rejects(buildRelease({xpi: mismatch}), /match this extension ID and version/);
});
