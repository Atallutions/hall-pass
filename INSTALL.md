# Installing Hall Pass

The same folder works in Chrome and in Firefox 140 or newer.

- **Chrome**: see [Chrome](#chrome).
- **Firefox**: three ways, from quickest to most permanent:

| Option | Survives a Firefox restart? | Needs |
| --- | --- | --- |
| [A. Temporary add-on](#a-temporary-add-on) | No | Nothing |
| [B. Self-signed (unlisted)](#b-self-signed-unlisted--recommended-for-daily-use) | Yes | A free addons.mozilla.org account |
| [C. Unsigned build](#c-unsigned-build-developer-edition--nightly--esr-only) | Yes | Firefox Developer Edition, Nightly or ESR |

For a focus tool you rely on every day, use **B**. With **A** you have to reinstall
it after every restart.

---

## Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.

Chrome keeps an unpacked extension installed across restarts, as long as the
folder stays where it is. Chrome may warn about an unrecognized
`browser_specific_settings` key. That key is Firefox's, and Chrome ignores it.

To update after code changes, click the reload icon on the Hall Pass card in
`chrome://extensions`, then reopen the popup and any open settings tab. Your
sites, schedules and unlock counts are kept. **Remove** deletes them.

---

## A. Temporary add-on

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` in this folder.

Firefox removes temporary add-ons when it quits, so repeat these steps after every
restart. Don't count on your sites, schedules and unlock counts surviving the
reinstall.

### Updating after code changes

Firefox reads the add-on straight from this folder, but it only picks up changes
once you reload it:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Reload** on the Hall Pass card.
3. Close and reopen the popup and any open settings tab.

Without the reload, pages you open (popup, settings) show the new code while the
background script keeps running the old version. That mismatch makes things look
broken, e.g. unlocks that aren't counted.

### Auto-reload while developing

```sh
npx web-ext run --source-dir .
```

This opens a throwaway Firefox profile with the add-on loaded and reloads it on
every save. It doesn't use your normal profile, so your normal sites and schedules
aren't there.

---

## B. Self-signed (unlisted) — recommended for daily use

Mozilla signs the add-on without publishing it. You get a normal `.xpi` that
installs permanently in regular Firefox.

1. **Get API keys (once).** Sign in at
   <https://addons.mozilla.org/developers/addon/api/key/> and generate a JWT
   issuer (key) and secret.

2. **Bump the version.** Mozilla won't sign the same version twice, so increase
   `"version"` in `manifest.json` (e.g. `1.0.0` → `1.0.1`) every time you sign.

3. **Sign it:**

   ```sh
   npx web-ext sign \
     --source-dir . \
     --channel=unlisted \
     --ignore-files "test/**" "*.md" \
     --api-key="$AMO_JWT_ISSUER" \
     --api-secret="$AMO_JWT_SECRET"
   ```

   The signed `.xpi` is written to `web-ext-artifacts/`. Signing usually takes a
   few minutes. If the command times out while waiting, the signed file shows up
   later under your add-on in the
   [Developer Hub](https://addons.mozilla.org/developers/addons).

4. **Install it:** open `about:addons`, click the gear icon, choose **Install
   Add-on From File…**, and pick the `.xpi`.

To update later: bump the version, sign again, and install the new `.xpi` the same
way. It replaces the old version and keeps your data, because the add-on ID
(`focus-blocker@local.dev`) stays the same. The ID keeps the old Focus Blocker
name on purpose: changing it would make Firefox treat Hall Pass as a different
add-on, without your data.

Don't commit your API key or secret. Keep them in environment variables or a
password manager.

---

## C. Unsigned build (Developer Edition / Nightly / ESR only)

Regular Firefox always requires signed add-ons. Developer Edition, Nightly and ESR
let you turn that off.

1. In `about:config`, set `xpinstall.signatures.required` to `false`.
2. Build the package:

   ```sh
   npx web-ext build --source-dir . --ignore-files "test/**" "*.md" --overwrite-dest
   ```

   This writes a `.zip` to `web-ext-artifacts/`. Rename it to `.xpi`.

3. Install it from `about:addons` → gear icon → **Install Add-on From File…**.

---

## After installing

- **Pin the icon.** Both browsers put new extensions in the extensions (puzzle
  piece) menu. Pin Hall Pass from there so the `ON` badge is always visible.
  In Chrome, click the pin next to it. In Firefox, click the gear next to it and
  choose **Pin to Toolbar**.
- **Private windows.** Extensions don't run in private windows by default. To
  block sites there too:
  - Chrome: `chrome://extensions` → Hall Pass → **Details** → **Allow in
    Incognito**.
  - Firefox: `about:addons` → Hall Pass → **Run in Private Windows** →
    **Allow**.
- **Site access.** Blocking needs access to all websites. Both browsers let you
  restrict it: in Chrome under **Details** → **Site access**, in Firefox under the
  add-on's **Permissions** tab. Leave it on all sites. If it's restricted, the
  popup says sites aren't being blocked and offers **Allow access to websites**.
- **Set it up.** Click the toolbar icon, then **Manage sites & schedule**, and add
  your sites. It comes with two weekday schedules, 09:00–13:00 and 14:00–18:00,
  which you can edit or remove there.

## Uninstalling

- Chrome: `chrome://extensions` → Hall Pass → **Remove**.
- Firefox: `about:addons` → Hall Pass → **⋯** → **Remove**.

Both delete its stored sites, schedules and unlock counts.
