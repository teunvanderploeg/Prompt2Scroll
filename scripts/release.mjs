import { mkdtemp, mkdir, cp, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildRelease({sourceRoot = root, xpi} = {}) {
  const {version} = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
  const extension = JSON.parse(await readFile(join(sourceRoot, 'dist/extension/manifest.json'), 'utf8'));
  if (version !== extension.version) throw new Error('Package and extension versions must match.');
  if (xpi) {
    xpi = resolve(xpi);
    const manifest = JSON.parse(execFileSync('unzip', ['-p', xpi, 'manifest.json'], {encoding: 'utf8'}));
    const entries = execFileSync('unzip', ['-Z1', xpi], {encoding: 'utf8'});
    if (manifest.version !== version || manifest.browser_specific_settings?.gecko?.id !== extension.browser_specific_settings.gecko.id) {
      throw new Error('The signed XPI must match this extension ID and version.');
    }
    if (!/^META-INF\/mozilla\.rsa$/im.test(entries)) throw new Error('The XPI has no Mozilla signature. Use the XPI returned by Mozilla signing.');
    // Firefox performs cryptographic signature verification during installation.
  }
  const temporary = await mkdtemp(join(tmpdir(), 'prompt2scroll-release-'));
  const name = `Prompt2Scroll-${version}${xpi ? '' : '-preview'}`;
  const folder = join(temporary, name);
  try {
    await mkdir(join(folder, 'scripts'), {recursive: true});
    await mkdir(join(folder, 'dist'), {recursive: true});
    for (const file of ['Install.command', 'install.sh', 'README.md']) await copyFile(join(sourceRoot, file), join(folder, file));
    await cp(join(sourceRoot, 'docs'), join(folder, 'docs'), {recursive: true});
    await copyFile(join(sourceRoot, 'scripts/install.mjs'), join(folder, 'scripts/install.mjs'));
    for (const directory of ['extension', 'companion']) await cp(join(sourceRoot, 'dist', directory), join(folder, 'dist', directory), {recursive: true});
    await writeFile(join(folder, 'package.json'), JSON.stringify({name: 'prompt2scroll-installed', version, private: true, type: 'module'}, null, 2) + '\n');
    await copyFile(join(sourceRoot, 'dist/companion/THIRD_PARTY_NOTICES.txt'), join(folder, 'THIRD_PARTY_NOTICES.txt'));
    if (xpi) await copyFile(xpi, join(folder, 'dist/prompt2scroll.xpi'));
    const releaseDirectory = join(sourceRoot, 'dist', 'releases', version);
    await mkdir(releaseDirectory, {recursive: true});
    const archive = join(releaseDirectory, `${name}.zip`);
    await rm(archive, {force: true});
    execFileSync('zip', ['-qr', archive, name], {cwd: temporary});
    const sha = createHash('sha256').update(await readFile(archive)).digest('hex');
    await writeFile(`${archive}.sha256`, `${sha}  ${name}.zip\n`);
    return archive;
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--xpi')) {
    console.error('Usage: npm run release -- [--xpi /path/to/mozilla-signed.xpi]');
    process.exitCode = 1;
  } else {
    try { console.log(`Share: ${await buildRelease({xpi: args[1]})}`); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
