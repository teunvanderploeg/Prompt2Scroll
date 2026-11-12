# Prompt2Scroll

A local Firefox extension. Distraction sites open while **every selected agent is running**, or while **any detected agent is running** with Any running agent enabled in Settings. When an agent needs input, finishes or errors, an already-open site shows a countdown in the top-right, three seconds by default, before covering the page with an attention overlay. If all selected agents resume, the countdown cancels. Missing, disconnected or stale state cannot grant access. Losing the last confirmed running session blocks immediately when its status is uncertain. The overlay lifts when the chosen running condition is met again, keeping your place.

## Start

Requires Node.js 22.13+ and desktop Firefox 142+. The installer supports macOS and Linux.

```sh
npm ci
npm run setup
```

1. Open Firefox `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on** and select `dist/extension/manifest.json`.
3. Start Codex through the monitor:

   ```sh
   npm run codex -- -C /absolute/path/to/project
   ```

4. Open the toolbar popup, choose Threads, and check the sessions you want to monitor. Use search and the source/status filters to find them. The three dropdowns filter source, thread status and last activity. Choose a recent-time preset or Custom range for an oldest/newest date and time. The filter uses real thread activity, independent of status heartbeats, and remembers your choices. Threads without an activity timestamp are omitted when a time range is active. Monitored threads stay pinned above the results, even when filters exclude them. Each row shows a small source label. Hover the status for its detection reason and last checked time. The popup remembers its active tab and list scroll positions. It stays 400 × 540 pixels across pages and selections; monitored and other rows share the same dimensions and column alignment.
5. Open Reddit or YouTube. By default all checked sessions must run. Enable **Any running agent** in Settings to allow access when any detected session is confirmed running; the thread list is muted and its selection checkboxes are disabled in this mode. Rows still open their sessions.

OpenCode v2 and T3 Code v2 sessions appear automatically when those apps are available locally. Start OpenCode normally. Its `opencode` command must be on PATH when you run setup. Codex requires a CLI version supporting `--remote` and `app-server --listen stdio://`, verified here with 0.167.1.

Click a T3 thread row to open that exact thread in the installed macOS desktop app. The companion launches its validated app link directly, so Firefox keeps the current page and creates no handoff tab. Only its checkbox changes monitoring. The link uses the app's `t3code://threads/environment-id/thread-id` handler. Where direct opening is unavailable, clicking the row copies the thread search or terminal resume command. Open requests carry only the session ID. Both the extension and companion check the app link against the agent and exact thread ID; arbitrary URLs and shell commands are not accepted.

The temporary add-on disappears when Firefox restarts. Reload it through `about:debugging`. A persistent release install needs Mozilla signing. `npm run package` produces a ZIP for signing or loading in a development Firefox profile.

## What runs locally

```text
Codex CLI ⇄ monitored JSON-RPC proxy ⇄ Codex app-server
                         ↓ private session files
OpenCode local API → companion ← T3 read-only SQLite
                         ↕ Firefox Native Messaging
                 background blocking policy
                         ↓
                  popup / attention page
```

Firefox starts the companion on demand. There is no daemon to manage, HTTP service, account, cloud sync, or telemetry. Codex's proxy listens on a random loopback port with a random bearer token and rejects browser-origin connections. The extension uses Native Messaging, with an allowlist for its fixed extension ID.

The popup stores selection, domains, filters and navigation locally. It also remembers selected thread names so disconnects keep identifiable rows without renewing their status. The companion reads local session metadata. It sends names, task titles, status and resume commands to Firefox, not full transcripts. Runtime files live in `~/.prompt2scroll/sessions` with owner-only permissions.

### Agent detection

- **Codex:** the wrapper proxies the CLI's actual app-server messages. Turn events identify Running, Completed and Error. Approval and user-input requests immediately mark Waiting for Input. Multiple outstanding requests must all resolve before access returns. A heartbeat and process check catch a dead proxy. Existing Codex sessions launched outside the wrapper are not inferred from log activity. Resume them through `npm run codex -- resume SESSION_ID` to monitor them.
- **OpenCode v2:** polls the authenticated local API through `opencode api`. `/api/session/active` gives live process-owned activity. Pending permissions and forms override Running. Retry and unknown states block. A failed API read removes that adapter's observations, which blocks selected sessions. The latest 100 sessions, all active sessions and explicitly selected older sessions are fetched. Older selected sessions that disappear block until deselected or resumed. V1 APIs are unsupported and block safely.
- **T3 Code v2:** reads its projection database in read-only mode, with a short SQLite lock timeout. An in-progress run takes precedence over newer queued follow-ups. Otherwise status comes from the latest run, or the latest actual provider turn for native subthreads without an app run. A connected provider alone does not mean work is running. Pending runtime requests override either source. Each poll confirms the recorded T3 process owns this database and its local port, and that its HTTP server responds. Active provider state must belong to this server lifetime, so saved Running flags from an earlier server cannot unlock sites. Quiet running turns stay Running without requiring new transcript activity. The live process probe uses `lsof`, included on macOS; install `lsof` on Linux if needed. This is an experimental adapter tied to the inspected v2 schema. Schema changes block safely. The latest 100 unarchived threads, all current running threads and every explicitly selected thread are listed. Active and selected threads remain included when older or archived. Deleted selected threads remain unavailable and block safely.

The companion polls adapters independently at approximately one-second intervals and streams snapshots over Native Messaging every second. Codex transitions also update its private file immediately. The extension rechecks freshness every second and blocks if either the companion snapshot or the selected agent observation reaches six seconds old. A successful live T3 check renews its observation, even when the thread has not produced new output. No selection also blocks.

### Website blocking

Defaults are X/Twitter, Reddit, YouTube, youtu.be and Instagram. Add a hostname or remove a website on the popup’s Websites tab. Each change saves immediately; duplicate hostnames are prevented and invalid input stays out of the list. Hostnames include their subdomains; `reddit.com.evil.example` does not match `reddit.com`.

Firefox's blocking `webRequest` listener redirects new restricted top-level visits before the site loads. Already-open matching tabs stay on their original document. When confirmed running work stops, a top-right warning shows the affected thread for the configured countdown duration. The deadline does not reset on further status updates; resuming all selected threads cancels it. At zero, a full-page attention overlay covers the site, disables interaction with the underlying page and pauses media. Scroll position, unfinished text and video position stay intact. Once all selected agents run again, the overlay lifts and previously playing media resumes. Existing page resources remain connected behind the overlay so the site retains its state; unprotected restricted requests are cancelled. Uncertain state covers immediately. If Firefox refuses content-script injection, the fallback redirects to the extension attention page. The extension needs all-site access to enforce custom domains. This is a focus aid within the Firefox profile where it is enabled.

### Configuration

Open the popup’s Settings tab to choose the countdown in whole seconds from 0 to 60. The default is 3; 0 switches immediately. Changes save automatically to local storage as you edit; the Saved confirmation clears after two seconds. The Dark mode switch applies to the popup, countdown and attention overlay and remembers your choice. If you change the duration during a countdown, its deadline stays anchored to when the thread stopped. Disconnected, stale and unknown state still block immediately. Any running agent saves automatically and uses all detected sessions, independent of filters or checkboxes. The countdown starts when the last confirmed running session stops; uncertainty or disconnection blocks immediately. Turning the option off restores the saved selected-thread policy. The Settings tab also contains connection details.

Run setup again after changing Node installations or your terminal PATH. Optional variables are inherited by the companion only if present in Firefox's environment, or explicitly exported in `~/.prompt2scroll/native-host`:

| Variable | Default |
| --- | --- |
| `P2S_CODEX` | `codex` executable used by the launcher |
| `P2S_OPENCODE` | `opencode` executable used for local API calls |
| `P2S_T3_DB` | `~/.t3/userdata/statev2.sqlite` |
| `P2S_HOME` | `~/.prompt2scroll`; use the same value for launcher and companion |

`npm run inspect` prints the discovered local metadata and adapter diagnostics. It does not call a model or start a task. If the popup says disconnected, check the Native Messaging manifest and rerun setup. If an adapter is unavailable, verify its version and path. Unavailable selected sessions remain checked so they cannot silently grant access.

To remove the companion, delete `~/.prompt2scroll/native-host` and `local.prompt2scroll.json` from `~/Library/Application Support/Mozilla/NativeMessagingHosts` on macOS or `~/.mozilla/native-messaging-hosts` on Linux. Remove the extension in Firefox. Runtime session files may be deleted after closing monitored Codex sessions.

Windows is not included in this MVP installer. It needs a native-host launcher and Firefox's Native Messaging registry registration.

## Development and verification

```sh
npm run check
npm test
npm run build
npm run lint:extension
```

Tests cover multi-session gating, every attention status, resume, no selection, missing agents, stale and future observations, disconnects, hostname boundaries, concurrent Codex approvals, OpenCode retry/input precedence, T3 status mapping, native message framing and companion shutdown. Background integration tests execute the bundled extension against Firefox API doubles to verify request redirection, subrequest cancellation, navigation-free existing-tab blocking, countdowns, resume and settings authorization. DOM tests verify that the overlay preserves page identity, drafts, focus, scroll position and video position, pauses playback while covered, and cancels when agents resume. Popup tests cover pinned selections, incremental status updates, preserved focus, website add/remove failures, automatic saves and navigation memory. Adapter tests cover selected threads beyond the recent-100 limit and supported T3 Open links.

Manual Firefox acceptance check:

1. Select two monitored sessions and start both. Open a configured site.
2. Finish or interrupt either session. A top-right countdown should show 3, 2, 1 before the attention overlay covers the site and pauses playback.
3. Resume both. The overlay should lift with the same scroll position, unfinished text and video position. No reload should occur.
4. Trigger an approval request. The countdown should appear before the overlay covers the sites. Answering the request and resuming all selected agents during those three seconds cancels the overlay.
5. Kill the Codex wrapper or disconnect the companion. Sites must stay blocked. Missing heartbeats block within six seconds plus the one-second checking interval.
6. Restart Firefox, reload the temporary extension, and confirm saved selection and domains remain.

To add an adapter, implement `Adapter.poll()` in `src/companion/adapters` and register it in `host.ts`. Use stable, provider-prefixed session IDs. Only report Running when a live source confirms it; do not renew an observation timestamp simply because an old saved record was reread.

Protocol references: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [OpenCode API](https://opencode.ai/docs/api), [Firefox request blocking](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onBeforeRequest). T3 mapping was checked against the local v2 SQLite schema.
