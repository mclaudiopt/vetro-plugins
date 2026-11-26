'use strict';
// Rules of the Notification Center that do not touch the network: sources (profiles), quiet hours, grouping of repeats and webhook templates.
// Pure functions, plain ES5 (older TVs run Node 4.4), so they can be tested on their own.
// Everything here receives raw JSON from the LAN: values are never passed to String() or parseInt() before their type is checked
// (String({toString: 1}) throws), and names are looked up with hasOwnProperty (so "__proto__" and "constructor" are not levels or modes).
var LEVEL_RANK = { info: 0, ok: 0, warn: 1, alert: 2 };
var LEVELS = { info: 1, ok: 1, warn: 1, alert: 1 };
var MODES = { both: 1, banner: 1, full: 1, overlay: 1 };
// Default wallpapers of the full-screen card, shipped with the Shard as small SVG files (wallpapers/<name>.svg).
var THEMES = { sport: 1, news: 1 };
// Wallpaper themes the user added (names only; the Shard keeps this in step with its configuration). A theme is a built-in one or one of these.
var CUSTOM_THEMES = {};
function hasTheme(n) { return has(THEMES, n) || has(CUSTOM_THEMES, n); }
// high: first in the queue, shown even in quiet hours, never merged as a repeat. Anything else is normal.
var PRIORITIES = { normal: 1, high: 1 };
// The sounds of the notification-sound Shard (a closed list: a request can only pick one of these names, never a file).
var SOUNDS = { chime: 1, soft: 1, reward: 1, success: 1, alert: 1, rotation: 1, open: 1, poweron: 1 };
// WAV files the user uploaded to the TV (names only; the Shard keeps this in step with its folder). A sound is a built-in one or one of these.
var CUSTOM = {};
function hasSound(n) { return has(SOUNDS, n) || has(CUSTOM, n); }
var SOURCE_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
var HOOK_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
var KEY_RE = /^[A-Za-z0-9._~-]{8,64}$/;
var MAX_SOURCES = 20, MAX_HOOKS = 10, MAX_TEMPLATE = 200, MAX_RATE = 600;

// Text from the outside: only strings, numbers and booleans are accepted; objects, arrays and null become ''.
function str(v) {
    var t = typeof v;
    return t === 'string' ? v : (t === 'number' || t === 'boolean') ? String(v) : '';
}
// An integer from the outside: numbers as they are, strings parsed, anything else NaN.
function num(v) {
    var t = typeof v;
    if (t === 'number') { return v === v && v !== Infinity && v !== -Infinity ? Math.floor(v) : NaN; }
    return t === 'string' ? parseInt(v, 10) : NaN;
}
// A volume from the outside: a number (or numeric text) is clamped to 10-100, so `volume: 0` or `5` means "as quiet as allowed", never "full".
// Missing, empty or not a number means "not given" (0), and the default (100) applies later.
function clampVolume(v) { var n = num(v); if (n !== n) { return 0; } return n < 10 ? 10 : (n > 100 ? 100 : n); }
// The default volume stored for a source or a webhook: the same, except that 0 or empty clears it.
function storedVolume(v) { var n = num(v); return n === 0 || n !== n ? 0 : clampVolume(n); }
function has(o, k) { return o !== null && typeof o === 'object' && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k); }
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function cleanSource(v) {
    var s = str(v).trim().toLowerCase();
    return SOURCE_RE.test(s) ? s : '';
}
function cleanHookName(v) {
    var s = str(v).trim().toLowerCase();
    return HOOK_RE.test(s) ? s : '';
}
function clampInt(v, lo, hi, def) {
    var n = num(v);
    if (!(n >= lo)) { return def; }
    return n > hi ? hi : n;
}

// Compares two keys without stopping at the first different character.
function sameKey(a, b) {
    a = str(a); b = str(b);
    var d = a.length ^ b.length, i, n = a.length > b.length ? a.length : b.length;
    for (i = 0; i < n; i++) { d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); }
    return d === 0;
}

// A stored profile. Only known fields are kept. `key` is kept as given (set by the Shard or by the user), never returned by GET.
// icon: cleaned by the caller (cleanIcon lives next to the emoji rules in index.js).
function sanitizeProfile(p, cleanIcon, old) {
    p = isObj(p) ? p : {}; old = isObj(old) ? old : {};
    var out = {
        enabled: p.enabled === false ? false : (p.enabled === true ? true : old.enabled !== false),
        icon: has(p, 'icon') ? cleanIcon(p.icon) : (old.icon || ''),
        level: has(LEVELS, p.level) ? p.level : (has(p, 'level') && !p.level ? '' : (old.level || '')),
        mode: has(MODES, p.mode) ? p.mode : (has(p, 'mode') && !p.mode ? '' : (old.mode || '')),
        duration: has(p, 'duration') ? clampInt(p.duration, 1, 60, 0) : (old.duration || 0),
        rate: has(p, 'rate') ? clampInt(p.rate, 0, MAX_RATE, 0) : (old.rate || 0),
        sound: has(p, 'sound') ? (hasSound(p.sound) ? p.sound : '') : (old.sound || ''),
        volume: has(p, 'volume') ? storedVolume(p.volume) : (old.volume || 0),
        theme: hasTheme(p.theme) ? p.theme : (has(p, 'theme') && !p.theme ? '' : (old.theme || '')),
        priority: has(p, 'priority') ? (p.priority === 'high' ? 'high' : '') : (old.priority || ''),
        key: old.key || ''
    };
    if (has(p, 'key')) {
        if (!p.key) { out.key = ''; }
        else if (typeof p.key === 'string' && KEY_RE.test(p.key)) { out.key = p.key; }
        else { out.error = 'key must be 8-64 characters: letters, digits and . _ ~ -'; }
    }
    return out;
}
// What GET returns: everything except the key itself.
function publicProfile(p) {
    return { enabled: p.enabled !== false, icon: p.icon || '', level: p.level || '', mode: p.mode || '', duration: p.duration || 0, rate: p.rate || 0, sound: p.sound || '', volume: p.volume || 0, theme: p.theme || '', priority: p.priority || '', hasKey: !!p.key };
}
// Fills in what the sender left out with the source's defaults. The sender's own values always win.
function applyProfile(body, p) {
    var out = {}, k;
    for (k in body) { if (has(body, k) && k !== '__proto__') { out[k] = body[k]; } }
    if (!p) { return out; }
    if ((out.icon == null || out.icon === '') && p.icon) { out.icon = p.icon; }
    if (!out.level && p.level) { out.level = p.level; }
    if (!out.mode && p.mode) { out.mode = p.mode; }
    if ((out.duration == null || out.duration === '') && p.duration) { out.duration = p.duration; }
    if ((out.sound == null || out.sound === '') && p.sound) { out.sound = p.sound; }
    if ((out.volume == null || out.volume === '') && p.volume) { out.volume = p.volume; }
    if ((out.theme == null || out.theme === '') && p.theme) { out.theme = p.theme; }
    if ((out.priority == null || out.priority === '') && p.priority) { out.priority = p.priority; }
    return out;
}

// Sliding one-minute window per source: returns true when another notification is allowed.
function makeLimiter() {
    var hits = {};
    return function allow(source, rate, now) {
        if (!rate) { return true; }
        var list = (has(hits, source) ? hits[source] : []).filter(function (t) { return now - t < 60000; });
        if (list.length >= rate) { hits[source] = list; return false; }
        list.push(now);
        hits[source] = list;
        return true;
    };
}

function minutes(hhmm) {
    var m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(str(hhmm));
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : -1;
}
// settings.quiet = { enabled, from: "22:00", to: "07:00", allow: "alert" | "warn" | "none" }: levels at or above `allow` still get through.
function sanitizeSettings(s, old) {
    s = isObj(s) ? s : {}; old = isObj(old) ? old : {};
    var q = isObj(s.quiet) ? s.quiet : {}, oq = isObj(old.quiet) ? old.quiet : {};
    var from = minutes(q.from) >= 0 ? q.from : (oq.from || '22:00'), to = minutes(q.to) >= 0 ? q.to : (oq.to || '07:00');
    var allow = q.allow === 'warn' || q.allow === 'alert' || q.allow === 'none' ? q.allow : (oq.allow || 'alert');
    return {
        quiet: { enabled: has(q, 'enabled') ? q.enabled === true : oq.enabled === true, from: from, to: to, allow: allow },
        groupSeconds: has(s, 'groupSeconds') ? clampInt(s.groupSeconds, 0, 3600, 0) : (has(old, 'groupSeconds') ? old.groupSeconds : 60),
        strict: has(s, 'strict') ? s.strict === true : old.strict === true,
        soundVolume: has(s, 'soundVolume') && !isNaN(num(s.soundVolume)) ? clampVolume(s.soundVolume) : (has(old, 'soundVolume') ? clampInt(old.soundVolume, 10, 100, 100) : 100),
        overlayOpacity: has(s, 'overlayOpacity') ? clampInt(s.overlayOpacity, 20, 100, has(old, 'overlayOpacity') ? clampInt(old.overlayOpacity, 20, 100, 88) : 88) : (has(old, 'overlayOpacity') ? clampInt(old.overlayOpacity, 20, 100, 88) : 88),
        // One sound for everything: replaces whatever sound a notification asks for; '' = each keeps its own. Silent ones stay silent.
        oneSound: has(s, 'oneSound') ? (hasSound(s.oneSound) ? s.oneSound : '') : str(old.oneSound),
        // For a TV whose native banner does not show: `banner` requests (also the ones without a mode) are drawn as the overlay bar.
        bannerAsOverlay: has(s, 'bannerAsOverlay') ? s.bannerAsOverlay === true : old.bannerAsOverlay === true,
        soundDelayMs: has(s, 'soundDelayMs') ? clampInt(s.soundDelayMs, 0, 10000, has(old, 'soundDelayMs') ? clampInt(old.soundDelayMs, 0, 10000, 3000) : 3000) : (has(old, 'soundDelayMs') ? clampInt(old.soundDelayMs, 0, 10000, 3000) : 3000)
    };
}
function defaultSettings() { return sanitizeSettings({}, {}); }
// `now` is a Date in the TV's local time.
function isQuiet(settings, level, now) {
    var q = settings && settings.quiet;
    if (!q || !q.enabled) { return false; }
    var a = minutes(q.from), b = minutes(q.to), t = now.getHours() * 60 + now.getMinutes(), inside;
    if (a < 0 || b < 0 || a === b) { return false; }
    inside = a < b ? (t >= a && t < b) : (t >= a || t < b);
    if (!inside) { return false; }
    if (q.allow === 'none') { return true; }
    return (has(LEVEL_RANK, level) ? LEVEL_RANK[level] : 0) < (q.allow === 'warn' ? 1 : 2);
}

// Webhook templates: "{{a.b.0.c}}" is replaced by that value of the JSON the sender posted. Plain text replacement, nothing is evaluated.
function lookup(data, pathText) {
    var parts = pathText.split('.'), cur = data, i;
    for (i = 0; i < parts.length; i++) {
        if (cur === null || typeof cur !== 'object' || !has(cur, parts[i])) { return ''; }
        cur = cur[parts[i]];
    }
    if (cur === null || cur === undefined) { return ''; }
    return typeof cur === 'object' ? JSON.stringify(cur) : str(cur);
}
function render(tpl, data) {
    return str(tpl).replace(/\{\{\s*([A-Za-z0-9_.-]{1,60})\s*\}\}/g, function (m, p) { return lookup(data, p); });
}
function sanitizeHook(h) {
    h = isObj(h) ? h : {};
    var t = function (v, max) { return str(v).replace(/[\x00-\x1f]/g, ' ').slice(0, max || MAX_TEMPLATE); };
    return {
        title: t(h.title), message: t(h.message), level: t(h.level, 40), icon: t(h.icon, 40),
        mode: has(MODES, h.mode) ? h.mode : '', duration: clampInt(h.duration, 1, 60, 0), source: cleanSource(h.source),
        sound: hasSound(h.sound) ? h.sound : '', volume: storedVolume(h.volume)
    };
}
// Builds the notify body from a hook definition and the posted data.
function buildFromHook(hook, data) {
    var level = render(hook.level, data).trim().toLowerCase();
    var b = { title: render(hook.title, data), message: render(hook.message, data), icon: render(hook.icon, data) };
    if (has(LEVELS, level)) { b.level = level; }
    if (hook.mode) { b.mode = hook.mode; }
    if (hook.duration) { b.duration = hook.duration; }
    if (hook.sound) { b.sound = hook.sound; }
    if (hook.volume) { b.volume = hook.volume; }
    return b;
}

module.exports = {
    clampVolume: clampVolume, storedVolume: storedVolume,
    LEVEL_RANK: LEVEL_RANK, LEVELS: LEVELS, MODES: MODES, THEMES: THEMES, CUSTOM_THEMES: CUSTOM_THEMES, hasTheme: hasTheme, PRIORITIES: PRIORITIES, SOUNDS: SOUNDS, CUSTOM: CUSTOM, hasSound: hasSound, MAX_SOURCES: MAX_SOURCES, MAX_HOOKS: MAX_HOOKS, MAX_TEMPLATE: MAX_TEMPLATE, MAX_RATE: MAX_RATE,
    str: str, num: num, has: has, isObj: isObj,
    cleanSource: cleanSource, cleanHookName: cleanHookName, sameKey: sameKey, KEY_RE: KEY_RE,
    sanitizeProfile: sanitizeProfile, publicProfile: publicProfile, applyProfile: applyProfile, makeLimiter: makeLimiter,
    sanitizeSettings: sanitizeSettings, defaultSettings: defaultSettings, isQuiet: isQuiet,
    render: render, sanitizeHook: sanitizeHook, buildFromHook: buildFromHook
};
