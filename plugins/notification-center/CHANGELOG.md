# Changelog

## 0.26.1

- **Fix:** when the banner service says it could not post a banner, or could not read the queue, the open app screen posts the banner instead of leaving it to nobody; a banner the service did post is still not repeated.

## 0.26.0

- **Panel:** a sender says what changes on the TV while one of its controls is off; the "New" mark goes away once the sender is opened (`seen.<source>.opened`, `POST profiles` `{source, opened: true}`); Try it has an example for each category (goal, civil protection, weather, news, reminder); Resend in the log also sends the sender (`source`), so its rules apply again, and a sender with a key refuses it; a message sent without a volume is resent at full volume, not at the lowest; on a phone the four ways of showing a message sit in two rows.
- **Fix:** a refused `POST service-report` no longer counts as a living banner service (which stopped the app screen from posting banners for 10 minutes).
- **Documentation:** `API.md` and `GET api` now give `priority`, `action` and `svc` in `GET notifications`, the fields of `GET recent`, the real time limits of a picture download (8 s per silent connection, 10 s in total), the `sound` and `volume` of webhooks, `handoff` in the status, the `key` field and a security note on what a sender defines.

## 0.25.0

- **The hub for every Shard:** new fields `category`, `ttl` and `replace`; every answer says what happened (`status`, `reason`, `effective`) and `GET notify-status` tells it later; `GET api` lists `features`.
- **Who decides:** each sender can have defaults per category and can be stopped from choosing the sound, how it appears or sending urgent ones. Senders appear by themselves with their categories.
- **Smaller package:** the emoji list keeps fewer search words (names in English and Portuguese still work), so that the TV accepts the package (516 KiB at most).
- **Panel:** Senders and rules shows the list and the chosen sender; the log in System shows sender, category and result, with filters; a chip warns about notifications that did not arrive.

## 0.24.0

- **Fixes:** a full queue now answers `429` with `Retry-After` instead of accepting and losing the notification; the bar shows one at a time instead of covering each other; the app screen no longer posts a banner the service already posts; a bar or app that cannot start is reported; `API.md` and `GET api` completed.

## 0.23.0

- The "Technical" tab is now called **System**.

## 0.22.0

- **A compact top bar:** name, state and language in one row across the whole width. The chips now show the companion app's version, the Shard's version and, while they are on, the quiet hours.

## 0.21.0

- **The common Shard layout:** tabs are Send, Try it, Senders and rules, Settings and Technical. Settings has the cards Notification (with banners as a bottom toast, Test and wallpapers), Sound (with one sound for everything and your own sounds), Quiet hours and Backup (with Reset settings). Repeats and unknown senders moved to Senders and rules. Technical has two columns: the checks and the API on the left, "Recently sent" on the right.

## 0.20.0

- **Easier to use, same Vetro look:** the message fields have labels and examples; the preview stays in view while you scroll; the three kinds of message sit in one row and "Choose icon" is next to its field; sending without a message says so in place; sliders say "Saved"; the two volumes have different names; quiet hours use time fields and are greyed out when off; senders and webhooks can be picked with the keyboard; the icon panel keeps and returns the focus; without an answer from the TV the panel says so and offers "Try again".

## 0.19.0

- **The rest of the Vetro dashboard's elements:** the preview is on the left; one card per group with a purpose icon; a sentence under the title; every field has its label; the checks show a state chip; a success shows as a toast and an error stays in place; deleting a sender, a webhook, a sound or a wallpaper asks first in an inline confirmation; empty lists say what is missing; the API table is framed, the icon picker is a side panel and the timing explanation is behind a disclosure.

## 0.18.0

- **The panel looks like Vetro:** the checkboxes are now Vetro's switch (name on the left, On / Off on the right), and colours, type, cards, buttons, fields, tabs, segmented views, chips and tables follow the Vetro dashboard. Dark only, as the dashboard. The tabs also move with the Left and Right keys, and the pickers tell screen readers which option is chosen. No change to the API or to what the controls do.

## 0.17.1

- **Diagnosis of the Samsung banner:** the banner service (companion app 0.2.4) reports whether it started, where it read the queue, whether `webapis.postPlainNotification` exists and what it threw (`POST service-report`). `GET status` shows it in `serviceDiag`, with what Vetro answered when asked to start the service. With an older app the Shard works as before.
- **Companion app 0.2.5:** where the runtime has no `fetch` (Node 12 on a Samsung monitor) and the queue file cannot be read, the banner service now asks the Shard with Node's `http`.

## 0.17.0

- **Banner as bottom toast:** the setting `bannerAsOverlay` (`POST settings`) shows every `banner` notification, including one without `mode`, as the `overlay` bar, for a TV where the native banner does not appear. `both` is not changed: its card already shows the content. Off by default.

## 0.16.0

- **One sound for everything:** the setting `oneSound` (`POST settings`) makes every notification that has a sound play that one, whatever the sender asked for. Silent notifications stay silent. Off by default.

## 0.14.1

- An update of the overlay helper is now always installed: the whole file is compared, not only its size.
- **Panel fixes to follow the Shard rules of Vetro:** the app suggestions of the action button come from a new route, `GET apps` (the panel may only use relative URLs). "Download the setup file" could not work in the sandboxed panel: it is now "Show the setup" with "Copy the text", and the other TV accepts the file or the pasted text.

## 0.14.0
- **Your own wallpaper themes (Settings):** a name and the address of a picture, next to sport and news (`GET/POST themes`); `theme` accepts them, sources can have one as default, and they travel in the setup file.
- The club buttons of Try it (0.13.2) stay for now, as a way to see how a crest looks; the crests of the clubs belong to the Match alerts Shard, which already sends them as `image` and will have its own test buttons.

## 0.13.2
- Try it: "Simulate a goal for a club" has a button for Sporting, Benfica, Porto and Feyenoord, each with the crest and the colour of the club, as the Match alerts sends them (replaces the two single examples of 0.13.1).

## 0.13.1
- Try it: the goal example uses one of the system sounds (a beep) instead of the own sound, and there are two new examples, a Sporting goal and a Benfica goal, each with the crest of the club and its colour, to see the logo change.

## 0.13.0
- **Priority:** field `priority` (`high`): first in the queue, shown even in quiet hours, never merged as a repeat; a source can have a default priority; ntfy priority 5 is high.
- **A button on the full-screen card:** field `action` `{app, label?}` adds a button that opens an installed app, next to a Dismiss button (Left/Right and OK on the remote); `POST action?id=` launches the app the notification named. Fields in the panel under More options.
- The card no longer shows debug text under the picture and the wallpaper.

## 0.12.0
- **Copy the setup to another TV:** `GET export` makes one JSON file with the settings, the sources, the webhooks and, if asked, your own sounds and the sender keys; `POST import` loads it on another TV through the same checks as every other route. Settings has "Download the setup file" and "Load a setup file".
- **Removed the Cast bridge** (`POST cast`, `GET cast`, "Send to all TVs"): it only worked while the TV that sends was on. The separate Cast Shard is not needed by this one any more.

## 0.11.0
- **The panel is organised for everyday use:** five tabs, Send, Try it, Settings, Senders and rules, Technical. Send has two steps (write the message, choose how it looks, with a plain sentence for each way to show it) and keeps the sound, pictures and duration under "More options". Try it has one-click examples (goal alert, breaking news, doorbell, simple message) and the "Is everything working?" check. Settings holds the sound volume and delay, your own sounds, the bottom toast opacity and the quiet hours. Deleting an own sound asks twice.
- The screen app sources (app/) are the ones of app 0.2.3: it asks the TV for its own address, so the full-screen card works without a local build.

## 0.10.0
- **Your own sounds:** upload a WAV (panel, Testing tab, or `POST sound-upload?name=<name>`) and use its name as `sound`, next to the eight system sounds. Checked on upload (WAV, PCM 16 bit, at most 10 s and 1 MB, at most 12), stored in a fixed folder on the TV and played by the same `paplay` command; a name is 1-24 characters of a-z, 0-9 and -. `GET sounds` has `custom`; `POST sound-delete` removes one.

## 0.9.0
- **Default wallpapers:** new field `theme` (`sport` or `news`) picks a small SVG wallpaper shipped with the Shard for the full-screen card; a `wallpaper` URL still wins. A source can have its own default theme, and the panel has a selector in the Notifications form and in Sources and rules.

## 0.8.6
- The countdown of the full-screen card is small and in the top-left corner of the screen (it was a big number in the middle of the card, only there for debugging). It comes from `nt.js`, so the installed app needs no update.

## 0.8.5
- Everything technical is in one tab, "Technical": the status and the companion app, the request examples for other apps and Shards, and the API. The descriptions of the overlay say "bottom toast" too.

## 0.8.4
- The overlay is called "Bottom toast" in the panel (the test button and the mode picker); the API name of the mode is still `overlay`.

## 0.8.3
- The test buttons of the Testing tab are named after what they send: "Default Notification", "Full screen", "Both" and "Bar".

## 0.8.2
- The top tabs of the panel are rounded buttons (dark, the open one lighter with a blue border), the same look as the Alerts Shard.

## 0.8.1
- New field `app`: the id of an app installed on the TV; its icon (served by Vetro at `/apps/icon`) is the picture of the notification when the request has no `image`, so the overlay bar can show an app's icon without a URL.

## 0.8.0
- **A volume below 10 is no longer the maximum:** `volume: 0`, `5` or `-3` is raised to 10 (the quietest), above 100 is lowered to 100, and only a missing or non-numeric volume means the default 100. One rule (`clampVolume` in `rules.js`) for `notify`, `POST play`, sources, webhooks and the `soundVolume` setting (which also accepts text such as `"5"`).
- At most 8 sounds wait for their banner at once (each waits with a 50 ms timer); a request over that gets `sound: "skipped"` instead of piling up timers.
- The docs now say what the code does (banner mode waits `soundDelayMs`, full and both up to 10 s), and the delay slider goes up to 10000 like the setting.
- **New mode `overlay`:** a bar near the bottom of the screen, drawn over the running picture by a small native helper (the same kind of window the Vetro launcher uses), so nothing is interrupted and no app is opened. Rounded corners, a stripe coloured by `level`, a title, a two-line message and an optional PNG icon (`image`). Setting `overlayOpacity` (20-100 %) sets the background transparency; the Testing tab has a button and a slider. The sound of an overlay plays at once. `GET status` has `overlay`.
- The Shard now has two fixed `exec` commands (the sound, and the overlay helper with a job file, never text on a command line). The helper source is `overlay/Overlay.cs` and the compiled helper is `overlay/ncoverlay.dll.b64`.

## 0.7.1
- `GET status` has a `screen` block: when the full-screen app last fetched `nt.js`, polled the queue and asked for a picture, and from which address. It shows where a full-screen card stops working (for example with Vetro pairing on).

## 0.7.0
- **Cast bridge (optional):** `POST cast` sends one notification to every TV of the network that has the Notification Center, through the separate Cast Shard on the same TV; `GET cast` says whether Cast is installed, how many TVs it knows and its groups. Same sender checks as `notify`; forwards message, title, icon, level, mode, duration and group or tvIds only. The panel has an option "Send to all TVs" next to the send button, shown only when Cast is installed.
- The sender checks (strict mode, source on/off, key, rate limit, defaults) are one function now, shared by `notify` and `cast`.

## 0.6.1
Follow-ups from the catalog review of 0.3.1 (versions 0.4.0 to 0.6.0 were only published in the author's own repository).
- The grouping memory is bounded: nothing is stored when grouping is off, entries older than the window are dropped, and at most 200 are kept (a flood of distinct notifications no longer slows every request).
- New field `group` (`false` = never merge): the panel's Resend and test buttons send it, so they always show instead of answering `merged` while the panel says "Sent again".
- README "Data it keeps" lists the sources (with their keys, stored as text), settings and webhooks; API.md says that a source key stops misconfigured senders, not hostile ones.

## 0.6.0
- **Volume setting:** `soundVolume` (10-100 %, default 100) replaces the old boost (`soundGain`); a slider next to the sound selector in the send form and in the Testing tab. The `volume` of a request is a share of it.
- **The sound is in time with the banner:** `soundDelayMs` (default 3000 ms) is how long after the request the sound starts; tune it by ear in the Testing tab (the banner service cannot tell the Shard when the banner appears). If the banner is recorded in the file the Shard reads, the sound starts as soon as it is seen. `GET sounds` has a `trace` of the last timing.
- **Goodie** in the Testing tab (`POST play` with `song`): about 10 seconds of a well-known tune made only of the notification sounds (*We Will Rock You*, the start of Beethoven's 5th), recognised by the rhythm. One song at a time, fixed in the code, same fixed command.

## 0.5.0
- **Sounds are part of this Shard now** (they were a separate notification-sound Shard in 0.4.0, which is no longer needed). The Shard asks for the `exec` permission for exactly one command, `paplay` on a fixed list of the TV's system sounds; the sound is chosen from a closed list and the volume is a clamped integer, so nothing from a request reaches the command. At most one sound every 0.8 s.
- The sound goes with the banner: it plays when the banner service has shown it (the Shard reads the file the service writes), when the app screen asks for a card, or after `soundDelayMs` (banner mode, default 3 s) or 10 s at the latest (full and both); with `open: false` at once.
- `sound` and `volume` on `notify`, ntfy, webhooks and source defaults; routes `GET sounds` and `POST play`; the boost is the setting `soundGain` (100-300 %, default 200) in `POST settings`; `GET status` reports `sound`.
- Panel: the Testing tab has the boost slider next to the sound tests.
- Tests with a fake `ctx.execute` that records every command and checks its shape.

## 0.4.0
- **Sounds:** any app can choose one of the TV's system sounds with `sound` (and `volume`) on `notify`, ntfy, webhooks and source defaults. In 0.4.0 the sound was played by a separate notification-sound Shard (merged into this one in 0.5.0). No sound unless one is asked for, and none for a notification held back by quiet hours or merged as a repeat. Routes `GET sounds` and `POST play`; `GET status` reports `sound`.
- Panel: new **Testing** tab (test banner/card/both, the API "Try it" form and sound tests); a sound selector in the send form and in the source and webhook forms.
- Tests with a fake Vetro for all of the above (`tests/notification-center-sound.test.cjs`).

## 0.3.1
Fixes from the catalog review.
- A request can no longer make the Shard fail: every value from the network is type-checked before it is converted (`{"message":{"toString":1}}` and similar threw), every body handler and the router catch errors, names are looked up with `hasOwnProperty` (`__proto__` and `constructor` are not levels, modes or sources).
- ntfy `tags` is only a real array or a comma list, at most 10 entries (a crafted `length` froze Vetro).
- Pictures: the route that fetched any URL (`img?url=`) is gone, the panel preview loads the URL itself; at most 2 downloads at once, 10 s in total each, and `stop()` aborts them.
- The queue file in `/tmp` is written under a new name (`wx`) and renamed over the target, so a symlink planted there is not written through.
- Resend keeps the wallpaper; request bodies are decoded as UTF-8 after all chunks arrive; the manifest description says that image URLs are fetched; README corrected about launch limits.

## 0.3.0
- **Sources:** a `source` per sender (or header `X-NC-Source`) with its own defaults (icon, level, mode, duration), on/off switch, rate limit per minute and optional key (header `X-NC-Key`, generated by the Shard, never returned). Routes `GET`/`POST profiles`.
- **Quiet hours:** a time window (may cross midnight) in which notifications below a chosen level are only recorded, not shown. **Grouping:** identical repeats inside a window are counted instead of shown again. Strict mode rejects unknown sources. Routes `GET`/`POST settings`.
- **Webhooks:** `POST hook/<name>` turns any JSON (GitHub, Home Assistant, Grafana...) into a notification with `{{path}}` templates. Routes `GET`/`POST hooks`.
- Panel: new tab "Sources and rules".
- Tests for all of the above (`tests/notification-center-rules.test.cjs`).

## 0.2.0
- **Banner over the running app, no app switch** (default mode `banner`): the companion app's background service posts the native Samsung banner. Works with Vetro pairing on (the queue is handed over in a file).
- Modes `banner`, `full` (full-screen card) and `both`; `duration` 1-60 s with a countdown; levels `info`, `ok`, `warn`, `alert`.
- Emoji icons: by level or picked in the panel from a bundled Unicode list; the icon is cut at whole emoji only.
- `image` and `wallpaper` on the full-screen card (fetched and served by the Shard).
- ntfy-compatible route (`POST ntfy`) and a documented API: `API.md`, `GET api` (self-description), `GET status`.
- Panel: three columns with a live preview, request generator, API explorer, installation status, English and Portuguese, recently sent list kept across restarts with Resend.
- The full-screen app is relaunched as soon as it has left; a notification queued while it is open extends its stay; a restarted banner service never repeats a banner.
- Node 4 compatibility: explicit request timeouts; run on a real Node 4.9.1.
- Tests: Shard behaviour, the banner service (in a sandbox) and a check that `GET api`, `API.md`, this changelog and the manifest agree.

## 0.1.0
- First version: queue notifications over HTTP and show them as the native banner through a companion app that comes to the foreground.
