# Technical notes

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

The popup stores selection, domains, filters and navigation locally. Settings changes apply only the edited option or thread/website action, and the background saves them in order so overlapping popups cannot restore an outdated watched list. It also remembers selected thread names so disconnects keep identifiable rows without renewing their status. The companion reads local session metadata. It sends names, task titles, status and resume commands to Firefox, not full transcripts. Runtime files live in `~/.prompt2scroll/sessions` with owner-only permissions. If several Codex launchers report the same thread, the monitor that first observed it most recently owns its status. Heartbeats from older monitors cannot take ownership back; a dead or stale current monitor blocks access.

### Agent detection

- **Codex:** the wrapper proxies the CLI's actual app-server messages. Turn events identify Running, Completed and Error. Approval and user-input requests immediately mark Waiting for Input. Multiple outstanding requests must all resolve before access returns. A heartbeat and process check catch a dead proxy. Existing Codex sessions launched outside the wrapper are not inferred from log activity. Resume them through `npm run codex -- resume SESSION_ID` to monitor them.
- **OpenCode v2:** polls the authenticated local API through `opencode api`. `/api/session/active` gives live process-owned activity. Pending permissions and forms override Running. Retry and unknown states block. A failed API read removes that adapter's observations, which blocks selected sessions. The latest 100 sessions, all active sessions and explicitly selected older sessions are fetched. Older selected sessions that disappear block until deselected or resumed. V1 APIs are unsupported and block safely.
- **T3 Code v2:** reads its projection database in read-only mode, with a short SQLite lock timeout. An in-progress run takes precedence over newer queued follow-ups. Otherwise status comes from the latest run, or the latest actual provider turn for native subthreads without an app run. A connected provider alone does not mean work is running. Pending runtime requests override either source. Each poll confirms the recorded T3 process owns this database and its local port, and that its HTTP server responds. Active provider state must belong to this server lifetime, so saved Running flags from an earlier server cannot unlock sites. Quiet running turns stay Running without requiring new transcript activity. The live process probe uses `lsof`, included on macOS; install `lsof` on Linux if needed. This is an experimental adapter tied to the inspected v2 schema. Schema changes block safely. The latest 100 unarchived threads, all current running threads and every explicitly selected thread are listed. Active and selected threads remain included when older or archived. Deleted selected threads remain unavailable and block safely.

The companion polls adapters independently at approximately one-second intervals and streams snapshots over Native Messaging every second. Codex transitions also update its private file immediately. The extension rechecks freshness every second and blocks if either the companion snapshot or the selected agent observation reaches six seconds old. A successful live T3 check renews its observation, even when the thread has not produced new output. An empty watched list allows access unless Any running agent mode is enabled.

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

`~/.prompt2scroll/inspect` prints the discovered local metadata and adapter diagnostics. It does not call a model or start a task. If the popup says disconnected, check the Native Messaging manifest and rerun setup. If an adapter is unavailable, verify its version and path. Unavailable selected sessions remain checked so they cannot silently grant access.

To remove the companion, delete `~/.prompt2scroll/app`, `~/.prompt2scroll/extension`, `~/.prompt2scroll/native-host`, `~/.prompt2scroll/codex`, `~/.prompt2scroll/inspect` and `local.prompt2scroll.json` from `~/Library/Application Support/Mozilla/NativeMessagingHosts` on macOS or `~/.mozilla/native-messaging-hosts` on Linux. Remove the extension in Firefox. Runtime session files may be deleted after closing monitored Codex sessions.

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
