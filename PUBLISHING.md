# Publishing Hall Pass

## Every release

1. Bump `"version"` in `manifest.json`. Neither store accepts a version it has
   already seen.
2. `npm test && npm run lint`
3. `npm run build`. This writes `web-ext-artifacts/hall-pass-chrome-<version>.zip`
   and `web-ext-artifacts/hall-pass-firefox-<version>.zip`.
4. Load `dist/chrome/` and `dist/firefox/` unpacked, and check them in each browser.
5. Upload each zip to its store (see below).

The code isn't minified or bundled, so Mozilla doesn't need a separate source
upload.

## Firefox: addons.mozilla.org

- Upload the zip at <https://addons.mozilla.org/developers/addon/submit/> and choose
  **On this site** (listed).
- The add-on ID is `hall-pass@atallutions.com`, and it can never change once the
  add-on is listed. Submit it as a new add-on. Unlisted builds signed under the old
  ID, `focus-blocker@local.dev`, belong to a separate add-on on AMO. Leave that one
  alone rather than deleting it, because AMO never lets you reuse a deleted add-on's ID.
- Compatibility: select only **Firefox** (desktop). The lint warning about Firefox for
  Android comes from `data_collection_permissions` needing Android 142. It doesn't
  matter until the add-on supports Android, and it has never been tested there.
- The listing needs a summary, a category (e.g. *Privacy & Security* or
  *Other*), a license, and screenshots. A privacy policy is optional, because the
  manifest declares that no data is collected.

## Chrome Web Store

- A developer account costs a one-time $5 fee:
  <https://chrome.google.com/webstore/devconsole>.
- Upload the zip, then fill in:
  - **Store listing**: description, category, at least one 1280×800 or 640×400
    screenshot, and a 440×280 small promo tile (required).
  - **Privacy practices**: a single purpose, and a justification for each
    permission. Also certify that no user data is collected.
- Expect a slower first review: `<all_urls>` host access always gets a closer look.

Justifications you can reuse for **Privacy practices**:

| Permission | Why |
| --- | --- |
| `declarativeNetRequestWithHostAccess` | Redirects sites the user chose to block to the extension's block page during focus time. |
| Host access `<all_urls>` | The user picks which sites to block, so they can't be listed in advance. Redirect rules only work on sites the extension has access to. |
| `storage` | Saves the user's blocked sites, schedules and pass counts on their device. |
| `alarms` | Starts and ends blocking when a schedule, session or pass begins or ends. |
| `notifications` | Tells the user when a focus session or break starts. |
