# Releases, signing, auto-update

> Load this doc when touching `.github/workflows/release.yml`,
> `package.json`'s `build` block, `build/entitlements.mac.plist`,
> `main.js`'s autoUpdater wiring, or the renderer's update status UI.

## TL;DR

Tag-driven release pipeline. Push `v*.*.*` to GitHub → CI runs two jobs
(mac arm64, win x64) → mac job signs + notarizes via electron-builder
in one step → both jobs publish a DRAFT release to GitHub. You publish
the draft manually. Installed app launches → after 60 s checks
`releases.atom` → if newer found, downloads, shows top-of-window
"Restart now" banner. Every electron-updater event fans into one IPC
channel (`update-status`) which both the banner and Settings → Updates
listen to.

## The decisions / invariants (locked in)

### Signing & notarization

- **VEP-wide single Developer ID Application cert.** Team ID
  `L5KZ5KGKXC`. Reused across PlotTwist, FlowCast, SlideFluid. NOT
  per-project.
- **Five GitHub secrets, identical names across VEP repos:**
  `CSC_LINK` (base64 of the .p12, single-line), `CSC_KEY_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- **`package.json` `mac.notarize.teamId` is hardcoded.** Without this
  electron-builder v24 calls `@electron/notarize` with
  `teamId: undefined` and it rejects.
- **Hardened runtime + 3 entitlements.** `com.apple.security.cs.allow-
  jit`, `allow-unsigned-executable-memory`, `allow-dyld-environment-
  variables`. No `disable-library-validation` (we have no PyInstaller
  backend).
- **`mac.target` needs BOTH `dmg` AND `zip`.** DMG = fresh install path;
  ZIP = what electron-updater downloads to swap the running .app. Drop
  the ZIP and auto-update breaks **forward-only** (you can't retroactively
  add a zip to a published release — the next release must include both).
- **Windows is unsigned for now.** Single NSIS target, x64. Add code
  signing later if needed.

### CI workflow

- **Single `electron-builder` step per platform.** No `--dir → ad-hoc
  codesign → --prepackaged --publish` dance. The mac job invokes
  `npx electron-builder --mac --publish always` with all 5 secrets in
  env; electron-builder signs, submits to `notarytool`, staples, and
  uploads.
- **Workflow-level `permissions: contents: write` is required.** Default
  GITHUB_TOKEN is read-only on new repos. Without this the upload step
  403s. Easy to forget — symptom is the build succeeds, notarization
  succeeds, then upload fails.
- **Notarization takes 5–30 min.** That's Apple's queue, not us.
- **Don't pass `--arm64` on the CLI.** `mac.target[].arch` already pins
  the arch in config; the CLI flag doesn't reliably override and has
  silently shipped x64 binaries in the past.

### Auto-updater wiring (main.js)

- **`autoDownload = false`, `autoInstallOnAppQuit = true`.** Ask before
  downloading; staged update applies on quit if user dismisses the
  restart prompt.
- **All six electron-updater events fan-in on `'update-status'`.** The
  renderer subscribes ONCE and paints state from the payload. NEVER add
  per-event IPC channels.
- **Launch check is delayed 60 s** (atom-feed cache lag — GitHub caches
  `releases.atom` several minutes after publish).
- **Three IPC handlers:** `check-for-updates` (returns one-shot result +
  emits events), `download-update`, `install-update` (calls
  `autoUpdater.quitAndInstall` inside `setImmediate` so the IPC ack
  flushes first).

### Update UI (renderer)

- **Top-of-window "Restart now" banner** appears on `'downloaded'`
  state. Shows version + install + dismiss buttons. Dismiss just hides;
  staged update still applies on next quit.
- **Settings → Updates tab** paints the same event stream as a live
  progress bar with the format `42%  ·  44.1 / 104.8 MB  ·  3.2 MB/s ·
  ~19s left`.
- **Errors show the raw electron-updater message verbatim.** Half the
  time it tells the user exactly what's wrong (read-only volume → "drag
  to /Applications first").
- **Renderer-side GitHub REST fetch fallback** (`renderer/updater.js`)
  backs the manual "View release" link. Separate from the autoUpdater
  path. CSP must allow `https://api.github.com` under `connect-src`.

### The seed-install gotcha

- **You can break the chain forward but never backward.** If version N's
  `latest-mac.yml` references a ZIP that no longer exists, the auto-
  update from N-1 → N fails permanently. Don't delete release artifacts.
- **First install ALWAYS manual.** The seed user downloads the DMG, drags
  to `/Applications`, launches from there. Subsequent updates flow.
- **Squirrel refuses read-only volumes.** Running the app from inside the
  mounted DMG, from `~/Downloads`, or from a Gatekeeper-translocated
  quarantine path → updates fail with "read-only volume" error. Not
  fixable in code (macOS sandboxing rule); surface the raw error so the
  user sees the path-fix hint.

## Code references

| File | What it owns |
|---|---|
| `.github/workflows/release.yml` | Tag-triggered mac+win build/sign/notarize/publish. |
| `package.json` (`build` block) | electron-builder config: mac/win targets, signing, dmg layout, publish target. |
| `build/entitlements.mac.plist` | The 3 hardened-runtime entitlements. |
| `main.js` (lines ~112–155, ~185–215) | `wireAutoUpdater`, `sendUpdateStatus`, IPC handlers `check-for-updates`/`download-update`/`install-update`. |
| `preload.js` | Exposes `onUpdateStatus`, `downloadUpdate`, `installUpdate`, `checkForUpdates` to renderer. |
| `renderer/app.js` (`bindAutoUpdater`) | Listens to `update-status`, shows banner on `'downloaded'`, re-broadcasts as CustomEvent for Settings tab. |
| `renderer/ui/settingsModal.js` (Updates tab) | Live progress bar + speed/ETA + error display. |
| `renderer/updater.js` | Renderer-side GitHub REST fallback for the manual "Check now" path. |
| `scripts/build-icons.sh` | Builds `icon.icns` / `icon.ico` / `dmg-bg.png` from `build/icon.svg`. |

## What NOT to do

- ❌ **Don't set `mac.identity: null`.** That disables signing. Old
  ad-hoc-signing pattern. Remove it if you see it.
- ❌ **Don't drop the `zip` target from `mac.target`.** Forward-only
  damage to the update chain.
- ❌ **Don't use `--no-verify` / `--no-gpg-sign` / `git commit --amend`
  during release work** unless you really mean it. The release tag
  expects the commit on `main` to be the one that built.
- ❌ **Don't `gh secret set --body -` (literal dash).** Pipe via stdin:
  `printf '%s' "$value" | gh secret set NAME --repo ...`.
- ❌ **Don't `base64` macOS-default the .p12** — it wraps at 76 columns
  and breaks electron-builder. Use
  `openssl base64 -A -in VEP_DevID.p12 | tr -d '\n'`.
- ❌ **Don't add per-event IPC channels for updater states.** Single
  `update-status` fan-in. Renderer painters subscribe once.
- ❌ **Don't tag a version without bumping `package.json` version
  first.** electron-builder reads the package.json version into the
  release; mismatch with the tag = confused atom feed.
- ❌ **Don't publish a draft without `gh release edit --draft=false`.**
  Drafts are invisible to electron-updater (atom feed skips them) so a
  draft = the auto-update chain stops here.
- ❌ **Don't expand the PDF-export BrowserWindow CSP** as a side effect
  of unrelated CSP work. The hidden PDF window is intentionally strict.
