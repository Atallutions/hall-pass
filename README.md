# Hall Pass

A Chrome and Firefox extension that blocks the sites you choose during your
working hours. If you need one of them, you can take a 5-minute pass. Each site
gets 6 passes a day.

## Using it

1. Click the toolbar icon, then **Settings**, and add the sites
   that distract you. Adding `reddit.com` also blocks its subdomains, such as
   `www.reddit.com`. Each category (News, Gambling, Social networks,
   Entertainment and Shopping to start with) has its own tab. You can rename
   them, remove them or add your own. Categories only sort the list, and every
   site follows the same focus time. Sites you add from the popup go under
   Uncategorized.
2. Choose how focus time starts, under **Focus time**:
   - **Schedules** block at set times. It comes with two weekday schedules,
     09:00 to 13:00 and 14:00 to 18:00, with lunch left open. You can edit
     them, remove them, or add your own. A schedule can run past midnight, for
     example 22:00 to 06:00.
   - **Sessions and breaks** block when you start a session from the popup.
     A session lasts 20, 30 or 45 minutes and is followed by a 5, 10 or 15
     minute break, when sites open. Sessions repeat until you end them or
     close the browser. A notification tells you when each break and session
     starts, and the toolbar badge shows the minutes left.
3. During focus time, opening a blocked site shows the block page.
   From there, or from the toolbar popup, you can take a pass for that site.
   Other blocked sites stay blocked.

With schedules, the toolbar badge shows `ON` while one is active. The popup
shows how long the current tab's pass has left, and the settings page shows how
many passes each site has used today. You can't end a pass early, and removing a
site doesn't reset its count.

## Install

See [INSTALL.md](INSTALL.md). In Chrome you load the folder unpacked. In
Firefox you load it as a temporary add-on, or sign it yourself for a permanent
install.

## How it works

The browser does the blocking through `declarativeNetRequest` rules. During
focus time, each blocked site has a rule that redirects it to
`blocked/blocked.html`, with the original URL after `#`. A site with an active
pass has an `allow` rule instead. Outside focus time there are no rules.

`background.js` rebuilds the rules whenever storage changes and whenever an
alarm fires. It sets an alarm for the next schedule start or end, session phase
change or pass expiry, plus a heartbeat every minute. The browser stops
`background.js` when it's idle, and the alarms start it again. Chrome runs it as a service worker and
Firefox as an event page. The same folder loads in both, because each browser
ignores the other's manifest keys.

The code enforces the limits, not only the UI. A message to the background
script can't get more than 5 minutes or more than 6 passes a day, or start a
session with lengths other than the ones offered. The code and
storage call passes "unlocks".

`common.js` has the scheduling, matching and rule-building logic. The
background script and every page load it. The pages also share `common.css`.

## Development

```sh
node test/common.test.js          # unit tests, no browser needed
npx web-ext lint --source-dir .   # lint the extension
npx web-ext run --source-dir .    # run in a throwaway Firefox profile that reloads on save
```

## Limitations

- It only blocks pages you open in a tab. A blocked site embedded in another
  page, for example in an iframe, still loads.
- Blocking can start or end up to about a minute late at a schedule or session boundary, or
  when a pass runs out, because the rules only change when an alarm fires.
- Blocking needs access to all websites. If you take that away in the browser's
  extension settings, the popup says sites aren't being blocked and offers a
  button to restore access.
- It isn't published on addons.mozilla.org or the Chrome Web Store.
