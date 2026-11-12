# Sharing a release

## Preview

Use Node.js 24+ to build and run the full test suite.

```sh
npm ci
npm run check
npm run build
npm test
npm run lint:extension
npm run release
```

Share `dist/releases/0.1.2/Prompt2Scroll-0.1.2-preview.zip` and its SHA-256 file. The archive contains the built extension, bundled companion and installer. Recipients need Firefox and Node.js, but no Git, npm install or build step. It works on macOS and Linux. Linux needs `lsof` for T3 detection. Windows is not supported yet.

The preview extension is temporary and disappears when Firefox restarts. For installation that survives restarts, sign the extension with Mozilla.

## Permanent installation

1. Create a [Mozilla Add-ons developer account](https://addons.mozilla.org/developers/) and obtain [API credentials](https://addons.mozilla.org/developers/addon/api/key/). Accept the agreement yourself.
2. Commit the exact source being released. Build it with `npm run package`, then make the source archive:

   ```sh
   git archive --format=zip --output=dist/prompt2scroll-source.zip HEAD
   ```

3. Set `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` in your shell. Keep them outside the repository. Submit for unlisted signing:

   ```sh
   npx web-ext sign --source-dir dist/extension --artifacts-dir dist/signed --channel unlisted --upload-source-code dist/prompt2scroll-source.zip
   ```

4. Package the XPI returned by Mozilla:

   ```sh
   npm run release -- --xpi /absolute/path/to/mozilla-signed.xpi
   ```

Share `dist/releases/0.1.2/Prompt2Scroll-0.1.2.zip`. Its installer copies the signed XPI into `~/.prompt2scroll` and prints the Firefox installation steps. Firefox verifies the signature. The release script checks that the XPI contains a Mozilla signature file and matches this extension's ID and version.

Before each update, bump the version in both `package.json` and `src/extension/manifest.json`, update the lockfile, and sign again. Users rerun the installer and install the new XPI. There is no automatic update service.

See Mozilla's [signing overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) and [installation from a file](https://extensionworkshop.com/documentation/publish/install-self-distributed/).

## GitHub

GitHub Actions checks macOS and Linux on each push and attaches a preview archive to the run. Publish the ZIP and checksum as release assets when ready. A private repository's releases are available only to people with access to that repository. Share the ZIP directly or invite them as collaborators.
