# Reproducing Prompt2Scroll 0.1.2

This archive contains the original TypeScript, HTML, CSS and SVG source, the build scripts and the npm lockfile. No private dependencies, credentials or accounts are needed to build it. Do not run the companion installer to reproduce the extension.

## Environment and tools

The submitted extension was built on macOS 26.6.2, ARM64, using Node.js 26.2.0 and npm 12.2.2. The build also supports Linux on ARM64 or x86_64. A POSIX shell and internet access to the public npm registry are required to install dependencies. Firefox and coding agent apps are not required to build.

1. Install Node.js **26.2.0** from the [official version directory](https://nodejs.org/dist/v26.2.0/). On macOS, run `node-v26.2.0.pkg`. On Linux, extract the `linux-arm64` or `linux-x64` archive for your CPU and add its `bin` directory to PATH. See the [Node.js installation guide](https://nodejs.org/en/download).
2. Node includes npm. If `npm --version` is not **12.2.2**, install that version with `npm install --global npm@12.2.2`. See the [npm installation instructions](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm).
3. Confirm `node --version` prints `v26.2.0` and `npm --version` prints `12.2.2`.

The lockfile fixes all dependency versions, including esbuild 0.28.2 and web-ext 10.8.0. `npm ci` installs them locally. No globally installed bundler or TypeScript compiler is used.

## Build

1. Extract this source ZIP into a new, empty folder.
2. Open a terminal in that folder, beside `package.json`.
3. Run:

   ```sh
   sh scripts/reviewer-build.sh
   ```

The script checks Node and npm versions, installs the locked dependencies with `npm ci`, and runs `npm run package`. The existing `scripts/build.mjs` compiles and bundles the browser TypeScript with esbuild, copies the HTML/CSS/SVG/manifest, and adds content hashes to local asset URLs. It also builds the separate native companion. web-ext then packages only `dist/extension` into the add-on ZIP.

The rebuilt extension files are in **`dist/extension/`**. The extension package is **`dist/releases/0.1.2/prompt2scroll-0.1.2.zip`**. Compare the unpacked files to the submitted extension. ZIP timestamps may differ; the extension file contents must match exactly. The separate `dist/companion` files are not part of the extension ZIP.

## Reviewing functionality

The extension connects only to the local Native Messaging host `local.prompt2scroll`. The companion source is in `src/companion`. It reads local coding agent status. The extension has no telemetry, remote executable code, cloud service or account system. All-site permission supports user-configured distraction domains. When running status cannot be confirmed, those domains stay blocked.

To exercise the companion, follow the installation steps in the root README on macOS or Linux. This is separate from reproducing the submitted Firefox extension.
