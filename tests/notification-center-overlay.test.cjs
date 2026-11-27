'use strict';
// The overlay mode: a bar drawn over the running picture by the Shard's own helper. The Shard unpacks the helper, writes the text into a job file and runs
// one fixed command; a fake ctx.execute records every command, so these tests also prove that no text from a request can reach it.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), zlib = require('zlib');
const {EventEmitter} = require('events');

const folder = path.join(__dirname, '../plugins/notification-center');
const create = require(path.join(folder, 'index.js'));
const rules = require(path.join(folder, 'rules.js'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function start(options = {}) {
    let config = options.seed || {};
    const commands = [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-ovl-'));
    const ctx = {
        id: 'notification-center', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-ovl-shard-')),
        config: {get: () => JSON.parse(JSON.stringify(config)), set: v => { config = JSON.parse(JSON.stringify(v)); }},
        queueFile: path.join(os.tmpdir(), 'nc-q-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json'),
        overlay: {dir: options.dir || dir, secondMs: options.secondMs || 0},
        sound: {gapMs: 0, waitMs: 0, songScale: 0.01}
    };
    if (options.vetro) ctx.vetro = options.vetro;
    if (options.execute !== null) {
        ctx.execute = cmd => { commands.push(cmd); return Promise.resolve({exit_code: 0, stdout: '', stderr: ''}); };
    }
    const shard = create(ctx);
    if (shard.start) shard.start();
    return {shard, commands, dir};
}
function call(shard, method, sub, body) {
    return new Promise((resolve, reject) => {
        const req = new EventEmitter();
        req.method = method; req.url = '/' + sub; req.headers = {}; req.destroy = () => {};
        const res = {writeHead(code) { this.code = code; }, end(text) { let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ } resolve({code: this.code, json: j, text}); }};
        if (!shard.route(req, res, sub)) return reject(new Error('route not handled: ' + method + ' ' + sub));
        setImmediate(() => { if (body != null) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); req.emit('end'); });
    });
}
async function withShard(fn, options) {
    const s = start(options);
    try { await fn(s.shard, s.commands, s.dir); } finally { if (s.shard.stop) s.shard.stop(); }
}
const jobLines = dir => fs.readFileSync(path.join(dir, 'job.txt'), 'utf8').split('\n');
// A 1x1 PNG (8-bit RGBA), made here so the test needs no file.
function tinyPng() {
    const crcTable = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
const COMMAND = /^P=[^ ]+\/pid; if \[ -f \$P \] && grep -q ncoverlay \/proc\/\$\(cat \$P\)\/cmdline 2>\/dev\/null; then kill \$\(cat \$P\) 2>\/dev\/null; fi; \( dotnet [^ ;&|`$"']+\/ncoverlay\.dll --file [^ ;&|`$"']+\/job\.txt >\/dev\/null 2>&1 & echo \$! > \$P \); echo started$/;

test('mode overlay is a known mode in rules and in the self-description', async () => {
    assert.ok(rules.MODES.overlay);
    await withShard(async s => {
        const d = await call(s, 'GET', 'api');
        assert.ok(d.json.enums.mode.includes('overlay'));
        assert.match(JSON.stringify(d.json), /overlayOpacity/);
        const st = await call(s, 'GET', 'status');
        assert.equal(st.json.overlay, true);
    });
});

test('an overlay unpacks the helper, writes the job file and runs one fixed command', () => withShard(async (s, commands, dir) => {
    const r = await call(s, 'POST', 'notify', {title: 'Doorbell', message: 'Someone is at the door', mode: 'overlay', level: 'warn', duration: 12});
    assert.equal(r.code, 200);
    assert.equal(r.json.open, 'requested');
    await wait(30);
    assert.equal(commands.length, 1);
    assert.match(commands[0], COMMAND);
    // the helper is the one shipped with the Shard
    const shipped = zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(folder, 'overlay', 'ncoverlay.dll.b64'), 'ascii'), 'base64'));
    assert.equal(fs.statSync(path.join(dir, 'ncoverlay.dll')).size, shipped.length);
    assert.match(fs.readFileSync(path.join(dir, 'ncoverlay.runtimeconfig.json'), 'utf8'), /netcoreapp3\.1/);
    assert.deepEqual(jobLines(dir).slice(0, 6), ['Doorbell', 'Someone is at the door', 'ffb020', '12', '88', '']);
}));

test('an overlay never goes through the queue the app and the banner service read, but is recorded', () => withShard(async s => {
    await call(s, 'POST', 'notify', {message: 'bar only', mode: 'overlay'});
    const q = await call(s, 'GET', 'notifications');
    assert.deepEqual(q.json.notifications, []);
    const rec = await call(s, 'GET', 'recent');
    assert.equal(rec.json.recent[0].mode, 'overlay');
}));

test('hostile text only ever lands in the job file, never in the command', () => withShard(async (s, commands, dir) => {
    const nasty = '$(touch /tmp/pwned); `id` "x" \'y\' & | ; > /tmp/p';
    await call(s, 'POST', 'notify', {title: nasty, message: nasty + '\nsecond line', mode: 'overlay', group: false});
    await wait(30);
    assert.equal(commands.length, 1);
    assert.match(commands[0], COMMAND);
    assert.ok(!commands[0].includes('pwned'));
    const lines = jobLines(dir);
    assert.ok(lines[0].includes('pwned'));
    assert.ok(lines[1].includes('second line'));   // a newline in a value cannot add a job line: it became a space
    assert.equal(lines.length, 11);                // ten values and the final newline
}));

// Serves the same PNG for every path ending in .png and for app icons, and a GIF for the rest; remembers what was asked.
async function withPictures(fn) {
    const png = tinyPng(), asked = [];
    const server = http.createServer((req, res) => {
        asked.push(req.url);
        if (/\.png$|^\/apps\/icon/.test(req.url)) { res.writeHead(200, {'Content-Type': 'image/png'}); res.end(png); } else { res.writeHead(200, {'Content-Type': 'image/gif'}); res.end(Buffer.from('GIF89a' + 'x'.repeat(60))); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    try { await fn('http://127.0.0.1:' + server.address().port, png, asked); } finally { server.close(); }
}
const recentOne = async s => (await call(s, 'GET', 'recent')).json.recent[0];

test('image and image2 are the left and right icons of the bar', () => withPictures((base, png) => withShard(async (s, commands, dir) => {
    await call(s, 'POST', 'notify', {message: 'home v away', mode: 'overlay', image: base + '/home.png', image2: base + '/away.png', group: false});
    await wait(300);
    assert.equal(commands.length, 1, 'one bar, started when both pictures are there');
    assert.ok(jobLines(dir)[5].endsWith('/icon.png'));
    assert.ok(jobLines(dir)[6].endsWith('/icon2.png'));
    assert.deepEqual(fs.readFileSync(path.join(dir, 'icon2.png')), png);
    await call(s, 'POST', 'notify', {message: 'away only', mode: 'overlay', image2: base + '/away.png', group: false});
    await wait(300);
    assert.equal(jobLines(dir)[5], '');
    assert.ok(jobLines(dir)[6].endsWith('/icon2.png'));
    await call(s, 'POST', 'notify', {message: 'one is not a png', mode: 'overlay', image: base + '/home.png', image2: base + '/away.gif', group: false});
    await wait(300);
    assert.ok(jobLines(dir)[5].endsWith('/icon.png'));
    assert.equal(jobLines(dir)[6], '');
    assert.equal(commands.length, 3);
    commands.forEach(c => assert.match(c, COMMAND));
})));

test('with bannerImageAsBar, a banner with a picture becomes the bar; without one it stays a banner, and full and both are not changed', () => withShard(async s => {
    assert.equal((await call(s, 'POST', 'notify', {message: 'off', image: 'http://127.0.0.1:9/a.png', open: false, group: false})).json.effective.mode, 'banner', 'off by default');
    await call(s, 'POST', 'settings', {bannerImageAsBar: true});
    // open: false, so nothing is launched; the pictures are on an address that does not answer.
    const base = 'http://127.0.0.1:9';
    for (const extra of [{image: base + '/a.png'}, {image2: base + '/b.png'}, {app: '9Ur5IzDKqV.TizenYouTube'}, {mode: 'banner', image: base + '/a.png'}, {mode: 'nonsense', image: base + '/a.gif'}]) {
        const r = await call(s, 'POST', 'notify', Object.assign({message: 'pic', open: false, group: false}, extra));
        assert.equal(r.json.effective.mode, 'overlay', JSON.stringify(extra));
        assert.equal((await recentOne(s)).mode, 'overlay');
    }
    for (const extra of [{}, {mode: 'banner'}, {image: 'file:///etc/passwd'}, {image2: 'javascript:alert(1)'}, {app: 'not an id!'}, {image: 'http://x/' + 'a'.repeat(300)}]) {
        await call(s, 'POST', 'notify', Object.assign({message: 'plain', open: false, group: false}, extra));
        const e = await recentOne(s);
        assert.equal(e.mode, 'banner', JSON.stringify(extra));
        assert.equal(e.image2, '');
    }
    for (const mode of ['full', 'both']) {
        await call(s, 'POST', 'notify', {message: mode, mode, image: base + '/a.png', image2: base + '/b.png', open: false, group: false});
        const e = await recentOne(s);
        assert.equal(e.mode, mode);
        assert.equal(e.image2, base + '/b.png');
    }
}, {vetro: {host: '127.0.0.1', port: 9}}));

test('a banner with a picture stays a banner when the bar cannot be drawn (no exec, or the helper cannot be unpacked)', async () => {
    const send = async s => {
        await call(s, 'POST', 'notify', {message: 'pic', image: 'http://pics.test/a.png', image2: 'http://pics.test/b.png', open: false});
        assert.equal((await recentOne(s)).mode, 'banner');
    };
    await withShard(send, {execute: null});
    const blocked = path.join(os.tmpdir(), 'nc-not-a-folder-' + process.pid);
    fs.writeFileSync(blocked, 'x');
    try { await withShard(send, {dir: blocked}); } finally { fs.unlinkSync(blocked); }
});

test('both pictures of a card are in GET notifications and served by GET img, each one its own', () => withPictures((base, png, asked) => withShard(async s => {
    const r = await call(s, 'POST', 'notify', {message: 'card', mode: 'full', image: base + '/home.png', image2: base + '/away.png', open: false});
    const n = (await call(s, 'GET', 'notifications')).json.notifications[0];
    assert.equal(n.image2, base + '/away.png');
    for (const q of ['id=' + r.json.id, 'kind=image2&id=' + r.json.id]) {
        await new Promise(resolve => {
            const req = new EventEmitter(); req.method = 'GET'; req.url = '/img?' + q; req.headers = {};
            s.route(req, {writeHead(code) { assert.equal(code, 200); }, end(buf) { assert.deepEqual(buf, png); resolve(); }}, 'img');
        });
    }
    assert.deepEqual(asked, ['/home.png', '/away.png']);
})));

test('a sender profile that asks for banner still gets the bar when the request has pictures, and keeps image2', () => withShard(async s => {
    await call(s, 'POST', 'settings', {bannerImageAsBar: true});
    await call(s, 'POST', 'profiles', {source: 'match', mode: 'banner', allowMode: false});
    await call(s, 'POST', 'notify', {source: 'match', message: 'goal', mode: 'full', image: 'http://pics.test/a.png', image2: 'http://pics.test/b.png', open: false});
    const e = await recentOne(s);
    assert.equal(e.mode, 'overlay');
    assert.equal(e.image2, 'http://pics.test/b.png');
}));

test('overlayOpacity is a setting (20-100) and goes into the job file', () => withShard(async (s, commands, dir) => {
    assert.equal((await call(s, 'GET', 'settings')).json.settings.overlayOpacity, 88);
    assert.equal((await call(s, 'POST', 'settings', {overlayOpacity: 40})).json.settings.overlayOpacity, 40);
    await call(s, 'POST', 'notify', {message: 'a', mode: 'overlay'});
    await wait(30);
    assert.equal(jobLines(dir)[4], '40');
    // like the other settings: below 20 the previous value stays, above 100 it becomes 100
    assert.equal((await call(s, 'POST', 'settings', {overlayOpacity: 5})).json.settings.overlayOpacity, 40);
    assert.equal((await call(s, 'POST', 'settings', {overlayOpacity: 500})).json.settings.overlayOpacity, 100);
    assert.equal(rules.sanitizeSettings({overlayOpacity: {toString: 1}}, {}).overlayOpacity, 88);
    assert.equal(rules.sanitizeSettings({}, {}).overlayOpacity, 88);
}));

test('the sound of an overlay plays at once, next to the bar command', () => withShard(async (s, commands) => {
    const r = await call(s, 'POST', 'notify', {message: 'ding', mode: 'overlay', sound: 'chime'});
    assert.equal(r.json.sound, 'requested');
    await wait(60);
    assert.equal(commands.length, 2);
    assert.ok(commands.some(c => /^paplay /.test(c)));
    assert.ok(commands.some(c => COMMAND.test(c)));
}));

test('quiet hours, open:false and a missing exec permission show no bar', async () => {
    const quiet = {settings: {quiet: {enabled: true, from: '00:00', to: '23:59', allow: 'none'}}};
    await withShard(async (s, commands) => {
        const r = await call(s, 'POST', 'notify', {message: 'shh', mode: 'overlay'});
        assert.equal(r.json.suppressed, 'quiet hours');
        assert.deepEqual(commands, []);
    }, {seed: quiet});
    await withShard(async (s, commands) => {
        const r = await call(s, 'POST', 'notify', {message: 'record only', mode: 'overlay', open: false});
        assert.equal(r.json.open, 'not requested');
        assert.deepEqual(commands, []);
    });
    await withShard(async s => {
        const r = await call(s, 'POST', 'notify', {message: 'no exec', mode: 'overlay'});
        assert.equal(r.code, 200);
        assert.equal(r.json.open, 'unavailable');
    }, {execute: null});
});

test('a PNG image becomes the icon; anything else is ignored and the bar still shows', async () => {
    const png = tinyPng();
    const server = http.createServer((req, res) => {
        if (req.url === '/icon.png') { res.writeHead(200, {'Content-Type': 'image/png'}); res.end(png); } else { res.writeHead(200, {'Content-Type': 'image/gif'}); res.end(Buffer.from('GIF89a' + 'x'.repeat(60))); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    try {
        await withShard(async (s, commands, dir) => {
            await call(s, 'POST', 'notify', {message: 'with icon', mode: 'overlay', image: base + '/icon.png', group: false});
            await wait(300);
            assert.equal(commands.length, 1);
            assert.ok(jobLines(dir)[5].endsWith('icon.png'));
            assert.deepEqual(fs.readFileSync(path.join(dir, 'icon.png')), png);
            await call(s, 'POST', 'notify', {message: 'gif icon', mode: 'overlay', image: base + '/other.gif', group: false});
            await wait(300);
            assert.equal(commands.length, 2);
            assert.equal(jobLines(dir)[5], '');
        });
    } finally { server.close(); }
});

test('app: the icon of an installed app (served by Vetro) becomes the picture; only a plain id is accepted', async () => {
    const png = tinyPng(), asked = [];
    const vetro = http.createServer((req, res) => {
        asked.push(req.url);
        if (req.url === '/apps/icon?appId=9Ur5IzDKqV.TizenYouTube') { res.writeHead(200, {'Content-Type': 'image/png'}); res.end(png); } else { res.writeHead(404); res.end('{}'); }
    });
    await new Promise(r => vetro.listen(0, '127.0.0.1', r));
    try {
        await withShard(async (s, commands, dir) => {
            await call(s, 'POST', 'notify', {message: 'from an app', mode: 'overlay', app: '9Ur5IzDKqV.TizenYouTube', group: false});
            await wait(300);
            assert.deepEqual(asked, ['/apps/icon?appId=9Ur5IzDKqV.TizenYouTube']);
            assert.ok(jobLines(dir)[5].endsWith('icon.png'));
            assert.deepEqual(fs.readFileSync(path.join(dir, 'icon.png')), png);
            // not a plain id: nothing is asked of Vetro and the bar still shows, without an icon
            asked.length = 0;
            await call(s, 'POST', 'notify', {message: 'bad app', mode: 'overlay', app: '../x?y=1&z', group: false});
            await call(s, 'POST', 'notify', {message: 'object app', mode: 'overlay', app: {toString: 1}, group: false});
            await wait(200);
            assert.deepEqual(asked, []);
            assert.equal(commands.length, 3);
            assert.equal(jobLines(dir)[5], '');
        }, {vetro: {host: '127.0.0.1', port: vetro.address().port}});
    } finally { vetro.close(); }
});

test('the helper source is shipped next to the compiled helper', () => {
    const src = fs.readFileSync(path.join(folder, 'overlay', 'Overlay.cs'), 'utf8');
    assert.match(src, /--file/);
    assert.ok(fs.statSync(path.join(folder, 'overlay', 'ncoverlay.dll.b64')).size > 1000);
    assert.ok(!/Process\.Start|System\.Net|Socket/.test(src), 'the helper starts no processes and opens no sockets');
});

test('bannerAsOverlay is off by default and a banner stays a banner', () => withShard(async s => {
    assert.equal((await call(s, 'GET', 'settings')).json.settings.bannerAsOverlay, false);
    await call(s, 'POST', 'notify', {message: 'plain', mode: 'banner', open: false});
    assert.equal((await call(s, 'GET', 'recent')).json.recent[0].mode, 'banner');
}));

test('bannerAsOverlay draws the bar for banner and for no mode, and leaves both and full alone', () => withShard(async (s, commands, dir) => {
    await call(s, 'POST', 'settings', {bannerAsOverlay: true});
    await call(s, 'POST', 'settings', {overlayOpacity: 70});
    assert.equal((await call(s, 'GET', 'settings')).json.settings.bannerAsOverlay, true);
    for (const extra of [{mode: 'banner'}, {}, {mode: 'nonsense'}]) {
        const r = await call(s, 'POST', 'notify', Object.assign({message: 'to the bar', group: false}, extra));
        assert.equal(r.json.open, 'requested');
        assert.equal((await call(s, 'GET', 'recent')).json.recent[0].mode, 'overlay');
    }
    await wait(30);
    assert.equal(commands.length, 3);
    commands.forEach(c => assert.match(c, COMMAND));
    assert.equal(jobLines(dir)[1], 'to the bar');
    assert.equal((await call(s, 'GET', 'notifications')).json.notifications.length, 0);
    for (const mode of ['both', 'full']) {
        await call(s, 'POST', 'notify', {message: mode, mode, open: false});
        assert.equal((await call(s, 'GET', 'recent')).json.recent[0].mode, mode);
    }
    await call(s, 'POST', 'settings', {bannerAsOverlay: false});
    await call(s, 'POST', 'notify', {message: 'back', open: false});
    assert.equal((await call(s, 'GET', 'recent')).json.recent[0].mode, 'banner');
}));

test('bannerAsOverlay keeps the banner when the bar cannot be drawn', () => withShard(async s => {
    await call(s, 'POST', 'settings', {bannerAsOverlay: true});
    await call(s, 'POST', 'notify', {message: 'no exec', open: false});
    assert.equal((await call(s, 'GET', 'recent')).json.recent[0].mode, 'banner');
}, {execute: null}));

test('service reports are cleaned, capped and shown in GET status', () => withShard(async s => {
    assert.equal((await call(s, 'POST', 'service-report', {nothing: 1})).code, 400);
    assert.equal((await call(s, 'POST', 'service-report', 'not json')).code, 400);
    for (let i = 0; i < 10; i++) await call(s, 'POST', 'service-report', {stage: 'queue', count: i, extra: 'dropped', error: 'x'.repeat(500)});
    const d = (await call(s, 'GET', 'status')).json.serviceDiag;
    assert.equal(d.reports.length, 8);
    assert.equal(d.reports[7].count, 9);
    assert.equal(d.reports[7].extra, undefined);
    assert.ok(d.reports[7].error.length <= 200);
    assert.equal(d.file, null);
}));

test('the bar settings: animated at the bottom by default, position, motion and its own duration go into the job file', () => withShard(async (s, commands, dir) => {
    const d = (await call(s, 'GET', 'settings')).json.settings;
    assert.deepEqual([d.overlayPosition, d.overlayMotion, d.overlayDuration], ['bottom', true, 8]);
    await call(s, 'POST', 'notify', {message: 'a', mode: 'overlay'});
    await wait(30);
    assert.deepEqual([jobLines(dir)[3]].concat(jobLines(dir).slice(7, 9)), ['8', '1', 'bottom']);
    const n = (await call(s, 'POST', 'settings', {overlayPosition: 'top', overlayMotion: false, overlayDuration: 15})).json.settings;
    assert.deepEqual([n.overlayPosition, n.overlayMotion, n.overlayDuration], ['top', false, 15]);
    // another setting leaves them as they are
    assert.equal((await call(s, 'POST', 'settings', {overlayOpacity: 50})).json.settings.overlayDuration, 15);
    const r = await call(s, 'POST', 'notify', {message: 'b', mode: 'overlay', group: false});
    assert.equal(r.json.effective.duration, 15);
    await wait(30);
    assert.deepEqual([jobLines(dir)[3]].concat(jobLines(dir).slice(7, 9)), ['15', '0', 'top']);
    // a duration of the request wins, and the other modes keep their own default
    assert.equal((await call(s, 'POST', 'notify', {message: 'c', mode: 'overlay', duration: 3, group: false})).json.effective.duration, 3);
    assert.equal((await call(s, 'POST', 'notify', {message: 'card', mode: 'full', open: false})).json.effective.duration, 8);
}));

test('the bar settings are cleaned', () => {
    const s = rules.sanitizeSettings({overlayPosition: 'left', overlayMotion: 'yes', overlayDuration: 500}, {});
    assert.deepEqual([s.overlayPosition, s.overlayMotion, s.overlayDuration], ['bottom', false, 60]);
    const kept = rules.sanitizeSettings({overlayDuration: {toString: 1}}, {overlayPosition: 'top', overlayMotion: false, overlayDuration: 20});
    assert.deepEqual([kept.overlayPosition, kept.overlayMotion, kept.overlayDuration], ['top', false, 20]);
});

test('the helper keeps a still bar for a TV where the animator cannot run', () => {
    const src = fs.readFileSync(path.join(folder, 'overlay', 'Overlay.cs'), 'utf8');
    assert.match(src, /EntryPointNotFoundException/);
    assert.match(src, /SettleCb/);
});


test('overlay is the flat bar, glass and panel say their look in the job file', () => withShard(async (s, commands, dir) => {
    for (const [mode, look] of [['overlay', ''], ['glass', 'glass'], ['panel', 'panel']]) {
        const r = await call(s, 'POST', 'notify', {message: mode, mode, group: false, replace: 'one'});
        assert.equal(r.json.effective.mode, mode);
        assert.equal(r.json.effective.duration, 8);
        await wait(30);
        assert.equal(jobLines(dir)[9], look, mode);
    }
    assert.deepEqual((await call(s, 'GET', 'notifications')).json.notifications, [], 'none of them goes to the app or the banner service');
}));

test('a panel with a button is the full-screen card, because the panel takes no remote keys', () => withShard(async s => {
    const r = await call(s, 'POST', 'notify', {message: 'open?', mode: 'panel', action: {app: '9Ur5IzDKqV.TizenYouTube'}, open: false});
    assert.equal(r.json.effective.mode, 'full');
    assert.equal((await call(s, 'POST', 'notify', {message: 'no button', mode: 'panel', action: {app: 'not an id!'}, open: false, group: false})).json.effective.mode, 'panel');
}));

test('defaultMode is the look of a request that names none; a named look and a sender profile win', () => withShard(async s => {
    const mode = async extra => (await call(s, 'POST', 'notify', Object.assign({message: 'm', open: false, group: false}, extra))).json.effective.mode;
    assert.equal(await mode({}), 'banner');
    assert.equal((await call(s, 'POST', 'settings', {defaultMode: 'glass'})).json.settings.defaultMode, 'glass');
    assert.equal(await mode({}), 'glass');
    assert.equal(await mode({mode: 'nonsense'}), 'glass');
    assert.equal(await mode({mode: 'banner'}), 'banner');
    assert.equal(await mode({mode: 'full'}), 'full');
    await call(s, 'POST', 'profiles', {source: 'news', mode: 'panel'});
    assert.equal(await mode({source: 'news'}), 'panel');
    assert.equal((await call(s, 'POST', 'settings', {defaultMode: '__proto__'})).json.settings.defaultMode, 'glass', 'a value that is no mode changes nothing');
    await call(s, 'POST', 'settings', {bannerAsOverlay: true});
    assert.equal(await mode({mode: 'banner'}), 'overlay');
    assert.equal(await mode({}), 'glass');
}));

test('the new look settings are cleaned, and are banner and off by default', () => {
    const s = rules.sanitizeSettings({}, {});
    assert.deepEqual([s.defaultMode, s.bannerImageAsBar], ['banner', false]);
    const kept = rules.sanitizeSettings({defaultMode: 'x', bannerImageAsBar: 'yes'}, {defaultMode: 'panel', bannerImageAsBar: true});
    assert.deepEqual([kept.defaultMode, kept.bannerImageAsBar], ['panel', false]);
});
