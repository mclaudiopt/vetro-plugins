# Notification Center API

Everything the Notification Center can show on the TV can be sent as an HTTP request, from **any source**: another Shard on the same TV, a PC, a phone, a script,
Home Assistant, a NAS, a doorbell, or any app that can publish to [ntfy](https://ntfy.sh). The panel is only one more client of this API.

The same description is available from the Shard itself: `GET /plugins/notification-center/api/api` returns the fields, enums, limits and routes as JSON, built from the code that
validates the requests. Use it to discover what a given TV supports.

> **Rule for contributors.** A new field, mode or route is added in four places together: the code (`index.js`, plus `nt.js` / `svc` if it changes what is shown), the
> self-description (`describe()` in `index.js`), this file, and the panel (`ui.html`). Fields are only ever added, never renamed or removed, so existing senders keep working.

## Where to send

| From | Address |
|---|---|
| Another Shard on the same TV | `http://127.0.0.1:8099/plugins/notification-center/api/<route>` (no key needed) |
| Any device on the LAN | `http://<TV-IP>:8099/plugins/notification-center/api/<route>` |

With Vetro pairing **off** no key is needed. With pairing **on**, devices other than the TV itself send `Authorization: Bearer <key>` (pair once with `POST /auth/pair`, then
`POST /auth/confirm` with the 6-digit code shown on the TV, as in Vetro's `SIGN-IN.md`).

## Send a notification: `POST notify`

JSON body. Only `message` is required.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `message` | string, max 200 | required | The text. |
| `title` | string, max 40 | empty | Bold line above the message. |
| `level` | `info` `ok` `warn` `alert` | `info` | Colours the card and the panel; the native banner gets the level's emoji. |
| `app` | string (an app id) | none | The id of an app installed on the TV, for example `9Ur5IzDKqV.TizenYouTube` (Vetro's `GET /apps` lists them). Its icon is used as `image` when the request has none (it never fills `image2`): the full-screen card shows it, and the `overlay` bar draws it as its left icon. Only a plain id (letters, digits, `.`, `_`, `-`, up to 64) is accepted; an unknown app gives no picture and the notification is shown anyway. |
| `priority` | `normal` `high` | `normal` | `high`: the notification goes to the **front** of the queue, is shown even in **quiet hours** and is never merged as a repeat. A source can have a default priority (`POST profiles`); the sender's own value wins. When the queue (5) is full the oldest normal notification is dropped; five high ones fill it. ntfy `Priority: 5` is `high`. |
| `action` | object `{app, label?}` | none | A **button on the full-screen card** (`full`, `both`): `app` is the id of an app installed on the TV (a plain id, up to 64 characters) and `label` is up to 24 characters (default `Open`). The card then shows that button and a Dismiss button; Left and Right on the remote move between them and OK presses. Pressing it opens the app and closes the card. The bar (`overlay`) and the Samsung banner take no input, so they have no buttons. |
| `theme` | `sport` `news`, or a theme you added (`GET themes`) | none | A default wallpaper for the full-screen card (`full`, `both`): `sport` and `news` are shipped with the Shard as small SVG files, your own themes are the picture address you gave them; used when the request has no `wallpaper` (a `wallpaper` URL always wins). A source can have its own default theme (`POST profiles`), so the Match alerts source can always be `sport`. In `GET recent` and `GET notifications` such a wallpaper shows as `theme:sport` / `theme:news`. |
| `mode` | `banner` `full` `both` `overlay` `glass` `panel` | setting `defaultMode` (`glass`) | `banner`: the native Samsung banner over whatever is running, no app switch. `full`: a full-screen card (the companion app comes to the front). `both`: card and banner. `overlay`, `glass` and `panel` are drawn **over the running picture** by this Shard's own helper (no app switch, no focus change): `glass` (and `overlay`, kept for older senders) a bar in glass style that slides and fades (`overlayMotion`), `panel` a dark panel almost the size of the screen with large logos and no buttons (a request with `action` is shown as `full`). In these three, `level` colours the stripe, a PNG `image` is the left icon, a PNG `image2` the right one, and `overlayOpacity` sets the background (the panel stays nearly opaque). With `bannerAsOverlay` every `banner` is shown as `overlay`; with `bannerImageAsBar` (off) only one with a picture. Without the helper (no `exec` permission) a banner stays a banner. `effective.mode` in the answer says what was chosen. |
| `duration` | integer 1-60 | `8` | Seconds on screen. A notification shown as the `overlay` bar without it uses the setting `overlayDuration` (default 8). |
| `icon` | string, max 16 | by level | One emoji (or emoji sequence) in front of the title, e.g. the ball for a goal. Cut at whole emoji only. |
| `image` | http/https URL, max 290 | none | A picture, for example the logo of a club (the home one): under the message on the **full-screen card**, and the left icon of the **bar** (PNG). |
| `image2` | http/https URL, max 290 | none | A **second picture**, for example the logo of the away club: next to `image` on the card, the right icon of the bar (PNG). Same rules as `image`. |
| `highlight` | `image` or `image2` | none | That logo fades in and out, in `glass` and `panel` with `overlayMotion` on, for example the club that scored. Check that `GET api` lists the feature `highlight`. |
| `wallpaper` | http/https URL, max 290 | none | A darkened full-screen background behind the card. Can be combined with `image`. |
| `seconds` | integer 5-300 | `30` | How long it may wait in the queue (always at least `duration` + 20). |
| `open` | boolean | `true` | `false` only queues it, without launching the app or its service. |
| `category` | string, max 24 (`a-z 0-9 _ -`) | none | What kind of notification it is, for example `goal`, `civil`, `weather`, `news`, `reminder`. A source can have its own defaults per category. |
| `ttl` | integer, 1-3600 | none | After this many seconds it is no longer shown (it replaces `seconds`). |
| `replace` | string, max 40 | none | A key of your own, for example `match-123`: a new notification of the same source with it replaces the one that waits, or the bar on screen. Never merged as a repeat. |
| `source` | string, max 32 (`a-z 0-9 . _ -`) | none | Who is sending (or the header `X-NC-Source`). If a source with that name exists, its defaults, allow switches, key, on/off switch and rate limit apply, see "Sources". |
| `key` | string, 8-64 | none | The key of the source, when it has one: this field, or the header `X-NC-Key` (which wins). `ntfy` and webhooks take the header only. It is never stored with the notification. |
| `group` | boolean | `true` | `false` = never merge this notification with an identical recent one (the panel sends `false` for Resend and the test buttons, so they always show). Merging only happens while the setting `groupSeconds` is above 0. |
| `sound` | `chime` `soft` `reward` `success` `alert` `rotation` `open` `poweron`, or the name of one of your own uploaded sounds (`GET sounds`, `custom`) | none | Plays that TV system sound, or your own sound, with the notification. Played by this Shard itself (one fixed `paplay` command), at most one sound every 0.8 s. It plays when the notification appears, not when it is queued: in `banner` mode it plays when the banner service has shown the banner, or `soundDelayMs` after the request (default 3 s, at most 10 s); in `full` and `both` when the app screen asks for the card (at most 10 s after the request); with `open: false` (nothing is shown) it plays at once. At most 8 sounds wait at the same time; a request over that gets `"sound":"skipped"`. Not played for a notification held back by quiet hours or merged as a repeat. |
| `volume` | integer 10-100 | `100` | Volume of the sound, in percent. A number below 10 is raised to 10 and above 100 lowered to 100 (so `volume: 0` is the quietest, never the loudest); missing or not a number means `100`. For the default volume of a source or a webhook, `0` or an empty value clears it. |

Answer: `{"ok":true,"id":"1-abc","open":"requested","sound":"none"}` (`sound` is `"requested"` when a sound was asked for). Errors: `400 {"error":"message is required"}` or `"invalid JSON"`; `403` (`invalid key for this source`, `source is disabled`, `unknown source`); `429` (`rate limit for this source`).
Two other answers are still `200`: during quiet hours `{"ok":true,"id":"...","suppressed":"quiet hours"}` (recorded in `GET recent`, not shown), and a repeat inside the grouping window `{"ok":true,"id":"...","merged":true,"count":2}`.

Notes:
- `image`, `image2` and `wallpaper` are fetched **by the Shard** (the app may only load origins it declares) and served back to the app. Up to 3 redirects, 3 MB, png/jpeg/gif/webp/bmp only. Time limits: a connection that stays silent for **8 s** is given up, and a whole download (redirects included) is stopped after **10 s**, however slowly it sends. At most 2 downloads run at once and 8 wait.
  The URL may be on your LAN (a camera snapshot). A picture that cannot be fetched shows "FAILED to load" with its address on the card.
- The native Samsung banner takes plain text and a duration only: no picture, no colour. Use `overlay`, `glass`, `panel`, `full` or `both` for pictures. In `both` the native banner is still text only; the card shows the pictures.
- **Logos from another Shard:** send `{"title":"Goal!","message":"Home 1-0 Away","image":"<home PNG>","image2":"<away PNG>"}` with `mode` `overlay`, `glass` or `panel`. Check that `GET api` lists the feature `image2`: an older Notification Center ignores the field, and shows `image` only in the other modes.
- Webhooks, `ntfy` and source profiles carry no picture address: pictures come from `POST notify` only. A profile's mode, theme and other defaults still apply to a request with pictures.
- `overlay` shows one bar at a time (a new one replaces the one still up), is not queued and does not launch any app, so it is not in `GET notifications`; it is recorded in `GET recent`. Its pictures must each be a **PNG** (up to 2 MB and 1024x1024, not interlaced, 8 bits per channel, palette and grey also 1, 2 or 4 bits; the helper decodes it itself, keeps its shape and draws it with rounded corners in a 128 pixel square); any other picture (JPEG, 16 bit, interlaced, too big) is left out and the bar shows without it. With a picture on both sides the message lines are shorter (about 56 characters each, two lines). The answer's `open` is `requested`, `unavailable` (no `exec` permission) or `error` (the helper could not be unpacked). The sound of an overlay plays at once, not after `soundDelayMs`.
- The queue holds up to 5 active notifications; the full-screen app is launched when it is not already open (it announces itself while open and when it leaves), at most once every 2 s, and a notification queued while it is open extends its stay; the banner service has no such limit.

```
curl -X POST http://<TV-IP>:8099/plugins/notification-center/api/notify \
  -H "Content-Type: application/json" \
  -d '{"title":"Doorbell","message":"Someone is at the door","mode":"full","level":"alert","duration":20,
       "image":"http://camera.local/snapshot.jpg","wallpaper":"https://example.com/night.jpg"}'
```

### From another Shard (ES5, no dependencies)

```js
var http = require('http');
function notify(fields) {                       // fields: the table above
    var body = JSON.stringify(fields);
    var rq = http.request({ host: '127.0.0.1', port: 8099, method: 'POST', path: '/plugins/notification-center/api/notify',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, function (r) { r.resume(); });
    rq.on('error', function () { /* Notification Center not installed or Vetro busy */ });
    rq.end(body);
}
notify({ title: 'Goal', message: 'Team 1-0 Rival (23\')', level: 'ok', duration: 30 });
```

The Match alerts Shard uses exactly this call.

### Other languages

```powershell
Invoke-RestMethod -Method Post -Uri "http://<TV-IP>:8099/plugins/notification-center/api/notify" -ContentType "application/json" `
  -Body (@{ title = "Backup"; message = "Finished"; level = "ok" } | ConvertTo-Json)
```
```python
import json, urllib.request
req = urllib.request.Request("http://<TV-IP>:8099/plugins/notification-center/api/notify",
    json.dumps({"title": "Oven", "message": "Dinner is ready", "mode": "both"}).encode(), {"Content-Type": "application/json"})
print(urllib.request.urlopen(req).read())
```
Home Assistant (`configuration.yaml`):
```yaml
rest_command:
  tv_notify:
    url: "http://<TV-IP>:8099/plugins/notification-center/api/notify"
    method: post
    content_type: "application/json"
    payload: '{"title":"{{ title }}","message":"{{ message }}","level":"{{ level | default(''info'') }}"}'
```

## What happened to it

`GET api` lists `features: ["category","status","ttl","replace","policy"]`; an older Notification Center has no `features`.

Every answer to `notify` that is accepted has `status`, `reason` and `effective` (`{mode, sound, volume, duration}`, what the Notification Center will really use):

| `status` | Meaning |
|---|---|
| `queued` | Accepted. Waiting for the TV to show it (banner, full screen, or a bar behind another bar). |
| `shown` | The bar was started now. In `GET notify-status` also a card the app screen has fetched. The Samsung banner gives no confirmation and stays `queued`. |
| `merged` | A repeat inside the grouping window: counted, not shown again. |
| `suppressed` | Held by quiet hours. |
| `failed` | The bar or the app could not be started (see `reason`). |

Later, `GET notify-status?id=<id>` answers `{ok, id, status, reason, source, category}` for the last 20, where the status can also be `replaced`, `expired`, `dropped` or `rejected`.

**Retrying:** a `429` (queue full, or over the source's rate) carries `Retry-After` and `retryAfter` in seconds: try again after it. Try again after a network error or a `5xx`; do not after `400` or `403`.

The bar shows one notification at a time, each for its `duration`; at most 5 wait, urgent ones first.

## Rules for other Shards

The Notification Center is the hub: it sets the defaults and the quiet hours, and a Shard asks only for what its user chose.

1. **Send everything through the hub** (`POST notify`). No `paplay`, banner or bar of your own.
2. **Discover** at start and every 10 minutes with `GET api`: `version`, `features`, `enums.sound`. Without `features` the hub is old: send only the old fields.
3. Always send a fixed `source` (for example `match-alerts`, `epg-alerts`) and a `category` (`goal`, `civil`, `weather`, `news`, `reminder`).
4. Send `sound`, `volume`, `mode` or `duration` **only if the user chose it in your Shard**. The first option of such a control is "Notification Center default", and then the field is left out, so the hub's defaults per sender and category apply.
5. **Sound:** when your Shard turns a sound on without the user picking which one, ask for `soft`. The owner of the TV can set `oneSound` (for example `soft`) so that every requested sound plays that one; a notification without `sound` stays silent. Do not change `oneSound` from a Shard.
6. `priority: "high"` only for what must pass quiet hours. Results that change use `replace`; news that goes stale uses `ttl`.
7. **No quiet hours of your own** (say "Set in the Notification Center"); keep only a small guard against bursts. Title up to 40 characters, message up to 200.
8. Mark something as told only after the hub accepted it (`queued`, `shown`, `merged`, `suppressed`) and log `status` and `reason`. Retry as in "Retrying" above, at most 3 times, not after the `ttl`, and cancel the timers in `stop()`.
9. **Panel: Vetro's controls**, not checkboxes or other unstyled native controls: an on/off option is the Vetro switch, and buttons, fields, tabs, segmented views and chips follow Vetro's [design system](https://github.com/andrearicci93/vetro/tree/main/app/design-system) (see "Interface rules" in the [README](README.md)).

## ntfy-compatible: `POST ntfy`

For apps that already publish to ntfy. The body is the message; headers `Title`, `Priority` (`5` = alert, `4` = warning) and `Tags` (`warning`, `rotating_light`,
`white_check_mark`, `tada`, `fire`, `soccer`, `bell`, `house`, `package`, `sunny`, `skull` set the icon and level). Or JSON `{"message","title","priority","tags"}`.

```
curl -X POST http://<TV-IP>:8099/plugins/notification-center/api/ntfy -H "Title: Oven" -H "Priority: 4" -H "Tags: tada" -d "Dinner is ready"
```

A sound can be chosen with the header `Sound` (or the JSON field `sound`, and `volume`), see `sound` above.

## Read and discover

| Route | Returns |
|---|---|
| `GET api` | This API as JSON: fields, enums, limits, routes, version. |
| `GET notifications` | `{lang, notifications:[{id,title,message,level,mode,duration,icon,image,image2,wallpaper,priority,svc,action,seconds}]}` (the active queue; `?js=1` for the script form used by the app). `priority` is `"high"` or `""`; `action` is `{label}` or `null` (the app id stays in the Shard); `svc: true` (banners only) means the banner service posts that banner, so the app screen must not post it again: the service reported in the last 10 minutes and has not said it failed (`post-failed` holds until it reports `posted`, `queue-failed` until it reads the queue). A banner it reported as posted stays `true`, one it could not post is `false`, and the open app screen then posts it; `seconds` is how long it still waits. |
| `GET recent` | `{recent:[{id,title,message,level,mode,duration,icon,image,image2,wallpaper,theme,priority,action,source,category,status,reason,sound,volume,at}]}` (the last 20, newest first, also the held back and refused ones). `action` is the button label; `status` and `reason` are explained in "What happened to it"; `at` is the time in milliseconds. `count` appears on one that repeats were merged into, `suppressed: true` on one held by quiet hours. A refused request has only `id,title,message,level,source,category,status,reason,at`. |
| `GET img?id=<id>[&kind=<kind>][&info=1]` | The picture of a queued notification: `image`, or with `kind` `image2` or `wallpaper`; `info=1` returns `{ok,type,bytes}` or `{ok:false,error}` (use it to check a URL). |
| `POST service-report` | Used by the banner service (companion app 0.2.4 or newer) to say what happened: `{stage, node, fetch, webapis, postFunction, source?, count?, fresh?, fileError?, netError?, error?, returned?, id?}`. Only these fields are kept, as short text; the last 8 are in `GET status`. Anyone who can reach the Shard can call it, so treat the content as a hint. |
| `GET status` | `{version, app, appVersion, service, handoff, serviceDiag, pairing:"on"\|"off"\|"unknown"}`: is the companion app and its banner service installed, is Vetro pairing on, `handoff`: did the Shard write the queue file the banner service reads. `overlay` is `true` when the Shard may run the overlay helper. `screen` says when the full-screen app last reached the Shard: `{ntjsAgoS, pollAgoS, imgAgoS, from, open}` (seconds since it fetched `nt.js`, polled the queue and asked for a picture, or `null` if never; the address it came from; whether it is open now). It is for finding out where a full-screen card stops working (for example with Vetro pairing on). `serviceDiag` is `{launch, reports, file}`: what Vetro answered the last time the Shard asked it to start the banner service (`{at, status, body}` or `{at, error}`), the reports the service sent over the network, and the copy it left in a file (`null` if there is none the Shard can read). |
| `GET lang` / `POST lang` | Display language `{lang:"en"|"pt"}`, shared by the panel and the TV screen. |
| `POST sound-upload?name=<name>` | Upload one of your own sounds: the raw bytes of a WAV (PCM 16 bit, mono or stereo, 8-48 kHz, at most 10 s and 1 MB) as the body, for example `curl -X POST --data-binary @goal.wav "http://<TV-IP>:8099/plugins/notification-center/api/sound-upload?name=goal"`. The name is 1-24 characters of `a-z`, `0-9` and `-` and cannot be one of the built-in sounds; at most 12 sounds. Answer `{ok,name,seconds}`; `400` for a bad name or a WAV the TV cannot play, `413` for more than 1 MB. Then send `sound: "goal"`. |
| `POST sound-delete` | `{name}`: delete one of your own sounds (`404` if there is none with that name). |
| `POST action?id=<id>` | Used by the card when the button of a notification is pressed: launches the app that notification named in `action` (never one named in this call). `404` if that notification has no button or is no longer in the queue, `429` if used less than 2 s ago. Answer `{ok, app}`. |
| `GET themes` | `{builtin:["sport","news"], custom:{<name>:<picture address>}, max:12}`: the wallpaper themes you can send as `theme`. |
| `POST themes` | `{name, url}` adds or changes one of your own themes, `{name, delete:true}` deletes it. `name` is 1-24 characters of `a-z`, `0-9` and `-` and cannot be `sport` or `news`; `url` is an http or https address of a picture (up to 290 characters, fetched by the Shard like a `wallpaper`); at most 12. A source can have it as its default theme. |
| `GET apps` | `{apps:[{appId,name}]}`: the apps shown on the TV, for the app id of an action button (empty if Vetro does not answer). |
| `GET export[?sounds=1][&keys=1]` | The setup of this Notification Center as **one JSON file** to copy to another TV: `{format:"notification-center-setup", formatVersion:1, shard, exportedAt, keysIncluded, settings, sources, webhooks, themes, sounds}`. By default it holds the settings, the sources (without their keys) and the webhooks; `sounds=1` adds your own sounds (WAV, base64, so the file is bigger) and `keys=1` adds the keys of the senders (keep that file private). Sent as a download (`notification-center-setup.json`). |
| `POST import` | The body is a file made by `GET export`, as it is (up to 12 MB). The settings are replaced; sources and webhooks of the same name are replaced and the others are kept; sounds are added. A source keeps its key when the file has none. Every part goes through the same checks as the other routes, so a hand-made or damaged file cannot store anything invalid. Answer `{ok, imported:{settings,sources,webhooks,sounds,themes}, skipped:[...]}` (what could not be used is in `skipped`); `400` for a file that is not a setup file, `413` over 12 MB. |
| `GET sounds` | `{sounds:[...], songs:[{name,title}], available, volume, delayMs, trace, last}`: the sounds a request can choose, the tunes of `POST play`, whether this Shard can play them (`exec` granted), the sound settings, when the last banner sound started (`trace`) and the result of the last attempt. |
| `POST play` | `{sound, volume?}`: play one sound without a notification (answer `{ok:true,sound:"requested"}`, `400` for an unknown name, `429` if another sound was played less than 0.8 s ago). `{song:"rock"}` or `{song:"fate"}`: a goodie, about 10 seconds of a well-known tune (*We Will Rock You*, the start of Beethoven's 5th) made only of these sounds and recognised by the rhythm; one song at a time (`409` while one plays), `{song:"stop"}` stops it. |
| `GET emoji` | The bundled emoji list (Unicode CLDR, MIT) used by the panel's icon picker. |

## Sources, quiet hours, grouping and webhooks

**Sources** give each sender its own defaults and rules. A source is a short name (`doorbell`, `home-assistant`, `match-alerts`); senders put it in `source` (or the header `X-NC-Source`).

| Route | What it does |
|---|---|
| `GET profiles` | `{profiles:{<source>:{enabled,icon,level,mode,duration,rate,sound,volume,theme,priority,allowSound,allowMode,allowUrgent,categories,hasKey}}, seen:{<source>:{categories,at,opened}}, max:20}`. `seen` lists the sources that have sent something (`opened: true` once the panel has opened it). The key is never returned. |
| `POST profiles` | Create, change or delete one: `{source, icon?, level?, mode?, theme?, duration?, sound?, volume?, rate?, enabled?, key?, genKey?, delete?}`. `icon`, `level`, `mode`, `duration`, `sound` and `volume` fill in what the sender leaves out (the sender's own value always wins). `rate` is the most notifications per minute (`0` = no limit). `key` (8-64 characters; `""` clears it) makes the source require the header `X-NC-Key`; `genKey: true` creates a random key and returns it **once**. `{source, opened: true}` only records that the panel opened a sender that has sent something (it loses the "New" mark); answer `{ok, source, opened}`. |

**Who decides.** A source can have defaults and defaults per category (`categories: {goal: {mode, sound, volume, duration}}`). What the request says wins, unless the source does not allow it: `allowSound`, `allowMode` and `allowUrgent` (all `true` by default). With one of them `false`, the request's value is ignored and the source's (or category's) default applies. Quiet hours are set only here; `allowUrgent` decides who can pass them.

**Settings:**

| Route | What it does |
|---|---|
| `GET settings` | `{settings:{quiet:{enabled,from,to,allow},groupSeconds,strict,soundVolume,oneSound,bannerAsOverlay,soundDelayMs,overlayOpacity,overlayPosition,overlayMotion,overlayDuration}}` |
| `POST settings` | Send only what changes. `quiet`: between `from` and `to` (`"22:00"` to `"07:00"`, TV local time, may cross midnight) nothing is shown below the level `allow` (`alert` lets only alerts through, `warn` lets warnings and alerts, `none` silences everything); suppressed ones are still listed in `GET recent`. `groupSeconds` (0-3600, default 60, `0` = off): a notification identical to one from the last `groupSeconds` (same source, title, message and level) is counted (`count` in `GET recent`) instead of shown again, and the answer is `{merged:true,count}`; send `group:false` to always show one (grouping is on by default, so a repeat pressed twice within a minute shows nothing). Only the last 200 distinct notifications are remembered. `strict: true` rejects notifications whose `source` has no profile. `soundVolume` (10-100 %, default 100) is the volume of every sound (the system sounds are quiet, so 100 % is already boosted; the `volume` of a request is a share of it). `overlayOpacity` (20-100 %, default 88) is the background of `overlay`, `glass` and `panel`. `overlayPosition` (`"bottom"` / `"top"`) is the edge of the two bars. `overlayMotion` (default `true`) lets `glass` slide and `panel` fade; off, or when the animator cannot run, they appear at once. `overlayDuration` (1-60 s, default 8) is used by the three when neither request nor source gives a `duration`. `defaultMode` (a `mode`, default `glass`) is the look of a request that names none and whose source sets none. `bannerImageAsBar` (default `false`): a banner with a picture is shown as `overlay`. `soundDelayMs` (0-10000, default 3000) is how long after the request the sound starts: the banner appears a few seconds after the request (Vetro has to start the banner service) and the Shard cannot see exactly when, so you tune this by ear in the Settings tab; if the banner service did record the id in a file the Shard can read, the sound starts as soon as it is seen. `oneSound` (a sound name, default `""` = off): every notification that has a sound plays this one instead, whatever the sender asked for; a notification without sound stays silent. `POST play` is not affected. `bannerAsOverlay` (default `false`), for a TV where the native banner does not show: every notification that resolves to `banner` is handled exactly like `overlay` (sound at once, not queued, recorded as `overlay`). `both` and `full` are not changed. Without the `exec` permission it stays a banner. |

**Webhooks** turn any JSON a service already sends (GitHub, Home Assistant, Grafana, a router) into a notification, without changing the sender:

| Route | What it does |
|---|---|
| `GET hooks` | `{hooks:{<name>:{title,message,level,icon,mode,duration,source,sound,volume}}, max:10, base}` |
| `POST hooks` | Create, change or delete one: `{name, message, title?, level?, icon?, mode?, duration?, sound?, volume?, source?, delete?}`. `name`: `a-z 0-9 -`, up to 24. The text fields are templates: `{{a.b.0.c}}` is replaced by that value of the posted JSON (a missing value gives an empty string; nothing is ever evaluated). `message` is required. |
| `POST hook/<name>` | Send any JSON (up to 64 KB) to that hook. A body that is not JSON is available as `{{text}}`. The notification is sent as source `source`, or the hook's name if `source` is empty, so a source's key protects its hook. |

Example, GitHub pushes: `POST hooks` with `{"name":"github","title":"{{repository.name}}","message":"{{pusher.name}} pushed {{head_commit.message}}","icon":"📦"}`, then give GitHub the URL `http://<TV-IP>:8099/plugins/notification-center/api/hook/github`.

## Security notes

- This Shard has the `exec` permission for exactly two fixed commands. (1) `paplay --volume=<integer> <file>`: the file is one of 8 fixed system files, or a WAV you uploaded into the Shard's own sound folder on the TV; a sound is chosen by name from a list the Shard keeps (an uploaded name is 1-24 characters of `a-z`, `0-9` and `-`, so it cannot contain a path or a shell character), and the volume is a clamped integer. Uploads are checked (WAV, PCM 16 bit, at most 10 s and 1 MB, at most 12 of them). (2) The overlay bar: `dotnet <dir>/ncoverlay.dll --file <dir>/job.txt`, plus closing the previous bar by its pid file (only if `/proc/<pid>/cmdline` contains `ncoverlay`); `<dir>` is a constant (`/home/owner/share/tmp/ncoverlay`), and the text, colour, seconds, opacity and icon path go into `job.txt`, one value per line, so no text from a request ever reaches a shell. The helper (source in `overlay/Overlay.cs`) only reads that file, clamps every value, and opens no sockets. In both cases no text from a request reaches a command. Anyone who can reach the Shard can make the TV play those sounds (at most one every 0.8 s); with pairing on they need a key.

- A source key is stored in `ctx.config` on the TV in plain text and checked by the Shard. It stops **misconfigured** senders (a script that picks the wrong source, a service you did not mean to allow), **not hostile ones**: anyone who can reach the Shard can also read the list of sources and change or delete a profile, including its key (`POST profiles`). It travels in clear text on the LAN like the rest of the traffic. Use Vetro pairing to keep strangers out; use keys to keep your own senders apart. `GET profiles` never returns a key.
- Anyone who can reach the Shard can change sources, settings and hooks, as they can change the language.
- **What a sender defines.** A request chooses the text, look and duration, the sound and its volume, `priority` (which passes quiet hours), the picture and wallpaper addresses the Shard will fetch (also on your LAN) and the button of the card (`action`), which opens an installed app **only if somebody presses it**. A source's `allowSound`, `allowMode` and `allowUrgent` overrule the sound, the look and the urgency only for requests that carry that `source`: a sender that leaves it out, or uses another name, is not held by them (`strict` refuses unknown names; a key stops others from using a name). Webhook definitions and source profiles hold no `action` and no picture address of their own (a profile can name a theme). Nothing sent with a notification runs a command.

- With pairing off, anyone who can reach the TV's port 8099 can send notifications and make the Shard fetch an image URL. Turn pairing on for shared networks.
- The Shard only fetches `http`/`https` URLs, never `file:` or other schemes, and serves only image types.
- The active queue (5) is kept in memory only. The list of the last 20 sent (`GET recent`) is kept in `ctx.config` on the TV so it survives restarts and updates; it holds the fields you sent, including any image or wallpaper URL. The display language is also kept there.
