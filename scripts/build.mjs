import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { mkdir,copyFile,cp,writeFile,readFile } from 'node:fs/promises';
await mkdir('dist/extension',{recursive:true});
await build({entryPoints:['src/extension/background.ts','src/extension/content.ts','src/extension/popup.ts','src/extension/blocked.ts'],bundle:true,loader:{'.css':'text'},outdir:'dist/extension',target:'firefox115',format:'iife'});
// Installed copies include their JS dependencies and do not need node_modules.
await build({entryPoints:['src/companion/host.ts','src/companion/codex-launch.ts'],bundle:true,outdir:'dist/companion',platform:'node',format:'esm',target:'node22',external:['bufferutil','utf-8-validate'],banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"}});
await copyFile('node_modules/ws/LICENSE', 'dist/companion/THIRD_PARTY_NOTICES.txt');
for (const f of ['manifest.json','popup.html','blocked.html','ui.css']) await copyFile(`src/extension/${f}`,`dist/extension/${f}`);
// Temporary Firefox add-ons cache assets even when local files change.
for (const page of ['popup','blocked']) {
  const path=`dist/extension/${page}.html`;
  let html=await readFile(path,'utf8');
  for (const asset of ['ui.css',`${page}.js`]) {
    const hash=createHash('sha256').update(await readFile(`dist/extension/${asset}`)).digest('hex').slice(0,12);
    html=html.replaceAll(`"${asset}"`,`"${asset}?v=${hash}"`);
  }
  await writeFile(path,html);
}
await cp('src/extension/icons','dist/extension/icons',{recursive:true});
console.log('Built dist/extension and dist/companion');
