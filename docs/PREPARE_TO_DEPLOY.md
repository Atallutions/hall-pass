# Preparing the first store release

This is the one-time checklist for getting Hall Pass onto addons.mozilla.org (AMO) and
the Chrome Web Store (CWS). For the steps on every later release, and the
permission justifications to paste into Chrome's form, see
[PUBLISHING.md](../PUBLISHING.md).

Already settled: the Firefox add-on ID is `hall-pass@atallutions.com`, and the
license is MIT.

## 1. Test the store builds

```sh
npm install
npm test && npm run lint
npm run build
```

Load `dist/chrome/` in `chrome://extensions` (**Load unpacked**) and `dist/firefox/`
in `about:debugging` (**Load Temporary Add-on**, pick its `manifest.json`). In each
browser, check that:

- [ ] The settings page opens on install, on its welcome tab.
- [ ] A site you add is blocked during a schedule and redirects to the block page.
- [ ] A pass opens the site for 5 minutes, and the pass count goes down.
- [ ] A session starts from the popup, the badge counts down, and a notification
      appears when the break starts. Use a 20/5 session, or wait out a shorter one.
- [ ] Outside focus time, nothing is blocked.

Remove the old Firefox install first: it uses the ID `focus-blocker@local.dev`, and
its data doesn't carry over to the new ID.

## 2. Accounts

- [ ] **AMO**: sign in at <https://addons.mozilla.org/developers/>. The account is
      free, and the one you used for unlisted signing works.
- [ ] **CWS**: register at <https://chrome.google.com/webstore/devconsole>.
  - [ ] Pay the one-time $5 fee.
  - [ ] Turn on 2-Step Verification for the Google account. Publishing requires it.
  - [ ] Verify the contact email.
  - [ ] Set the **trader / non-trader** status (EU Digital Services Act). As a
        trader, which fits an Atallutions release, the listing publicly shows a
        business address, email and phone number. Have those ready.

## 3. Privacy policy

Neither store strictly requires one when nothing is collected, but Chrome's reviewers
often ask for one when an extension can access every site. Publishing one avoids a
round of review.

- [ ] Write a short policy. Hall Pass stores its sites, schedules and pass counts
      in the browser's local extension storage, sends nothing anywhere, and has no
      analytics.
- [ ] Host it at a public URL. A `PRIVACY.md` in the GitHub repo works only if the
      repo is public; otherwise use a page on atallutions.com or GitHub Pages.

## 4. Listing text

Write it once and reuse it in both stores.

- [ ] **Summary**: the manifest description works. Chrome allows 132 characters and
      AMO 250.
- [ ] **Description**: base it on the "Using it" section of the README. Mention the
      5-minute passes, the 6 per day limit, schedules, and sessions and breaks.
- [ ] **Category**: CWS *Productivity* (*Workflow & Planning*). AMO *Privacy &
      Security* or *Other*.
- [ ] **Homepage / support URL**: the GitHub repo or its issues page, if the repo is
      public, otherwise an atallutions.com page or email.
- [ ] **CWS single purpose**, e.g.: "Blocks the websites the user chooses during
      their focus time, with a limited number of short passes per day."

## 5. Images

- [ ] **Screenshots** of the popup, the block page, the settings page's blocked
      sites tab and the focus time tab.
  - CWS: 1 to 5 images, exactly 1280×800 or 640×400.
  - AMO: any reasonable size; reuse the same files.
- [ ] **CWS small promo tile**: 440×280, required. The icon and name on a plain
      background is enough.
- [ ] **CWS store icon**: 128×128. Upload `icons/icon-128.png`.

## 6. Submit to Firefox

- [ ] At <https://addons.mozilla.org/developers/addon/submit/>, choose **On this site**.
- [ ] Upload `web-ext-artifacts/hall-pass-firefox-1.1.0.zip`.
- [ ] Compatibility: **Firefox** only. Leave Android unchecked, because it hasn't
      been tested there.
- [ ] Source code: answer **No**. Nothing is minified or bundled.
- [ ] Fill in the listing from steps 3–5, with license **MIT**.
- [ ] Don't delete the old unlisted `focus-blocker@local.dev` add-on if it's there.
      AMO never lets you reuse a deleted add-on's ID.

Review usually takes hours to a few days.

## 7. Submit to Chrome

- [ ] In the developer dashboard, click **New item** and upload
      `web-ext-artifacts/hall-pass-chrome-1.1.0.zip`.
- [ ] **Store listing**: fill it in from steps 4–5.
- [ ] **Privacy practices**:
  - [ ] Enter the single purpose.
  - [ ] Copy one justification per permission from the table in
        [PUBLISHING.md](../PUBLISHING.md).
  - [ ] Declare that no user data is collected, and tick the three certifications.
  - [ ] Add the privacy policy URL.
- [ ] **Distribution**: Public, all regions, free.
- [ ] Submit for review. Access to every site means a closer review, so expect it
      to take longer than usual.

## 8. After approval

- [ ] Replace "It isn't published on addons.mozilla.org or the Chrome Web Store" in
      the README with links to both listings, and update the Install section.
- [ ] Tag the release: `git tag v1.1.0 && git push --tags`.
