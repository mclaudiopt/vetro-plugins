# Changelog

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
