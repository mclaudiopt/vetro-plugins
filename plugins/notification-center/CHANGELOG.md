# Changelog

## 0.30.4

- Documentation brought up to date. No change in behaviour.

## 0.30.3

- The default look is now `glass`: a request without `mode` is the glass bar (the banner when the helper cannot run). A TV that saved another default keeps it.
- One bar only: the panel offers the glass bar, and `mode: overlay` is drawn as it. Turn "Animate the bar" off for a still bar.
- Panel: the native banner look is now called "Samsung".

## 0.30.2

- The panel no longer offers "Both"; requests with `mode: both` work as before.

## 0.30.1

- The club goal examples left the panel: the news Shard (Match alerts) simulates goals itself, with its own clubs and options.

## 0.30.0

- New field `highlight` (`image` or `image2`): that logo fades in and out in `glass` and `panel` (setting `overlayMotion` on), for example the club that scored.

## 0.29.0

- New looks: `mode: glass` (animated glass bar) and `mode: panel` (large dark panel, no buttons). `overlay` stays the flat bar.
- A banner with a picture is a banner again unless `bannerImageAsBar` is on.
- Settings `defaultMode`, `overlayPosition`, `overlayMotion`, `overlayDuration`.
- Titles and messages are cut by their real width.

## 0.27.0

- **Pictures for every Shard (club logos and the like):** new field `image2`, a second picture with the same rules as `image` (home and away). The bottom toast draws `image` on the left and `image2` on the right; the full-screen card shows both. `GET api` lists the feature `image2`; `GET notifications`, `GET recent` and `GET img?kind=image2` carry it, and Resend keeps it.
- **Change:** a banner request (or one without `mode`) that has a picture (`image`, `app` or `image2`) is shown as the bottom toast, because the Samsung banner cannot show pictures. When the bar cannot be drawn it stays a banner; requests without a picture are unchanged.
- **Bottom toast:** palette and grey PNGs with 1, 2 or 4 bits are drawn too; a logo that is not square keeps its shape; no empty space is left for a picture that cannot be decoded.

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

Older versions: see the git history of this folder.
