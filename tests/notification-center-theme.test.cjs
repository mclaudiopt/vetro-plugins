'use strict';
// Default wallpapers for the full-screen card: the field `theme` (sport, news) picks a small SVG shipped with the Shard.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const {EventEmitter} = require('events');

const folder = path.join(__dirname, '../plugins/notification-center');
const create = require(path.join(folder, 'index.js'));
const rules = require(path.join(folder, 'rules.js'));

function start() {
    let config = {};
    const ctx = {
        id: 'notification-center', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-theme-')),
        config: {get: () => JSON.parse(JSON.stringify(config)), set: v => { config = JSON.parse(JSON.stringify(v)); }},
        queueFile: path.join(os.tmpdir(), 'nc-q-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json'),
        sound: {gapMs: 0, waitMs: 0, songScale: 0.01}
    };
    const shard = create(ctx);
    if (shard.start) shard.start();
    return shard;
}
function call(shard, method, sub, body) {
    return new Promise((resolve, reject) => {
        const req = new EventEmitter();
        req.method = method; req.url = '/' + sub; req.headers = {}; req.destroy = () => {};
        const res = {
            writeHead(code, headers) { this.code = code; this.headers = headers || {}; },
            end(data) { const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || ''); let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ } resolve({code: this.code, headers: this.headers, json: j, text, raw: data}); }
        };
        if (!shard.route(req, res, sub)) return reject(new Error('route not handled: ' + method + ' ' + sub));
        setImmediate(() => { if (body != null) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); req.emit('end'); });
    });
}
async function withShard(fn) {
    const s = start();
    try { await fn(s); } finally { if (s.stop) s.stop(); }
}
const queued = async s => (await call(s, 'GET', 'notifications')).json.notifications;

test('the two wallpapers are shipped as small, valid SVG files', () => {
    assert.ok(rules.THEMES.sport && rules.THEMES.news);
    for (const name of ['sport', 'news']) {
        const file = path.join(folder, 'wallpapers', name + '.svg'), text = fs.readFileSync(file, 'utf8');
        assert.match(text, /^<svg /);
        assert.ok(text.length < 4000, name + ' is small');
        assert.ok(!/<script|onload=|href=/i.test(text), name + ' has no script or links');
    }
});

test('a theme gives the card its wallpaper, and the picture route serves it from the plugin folder', () => withShard(async s => {
    const r = await call(s, 'POST', 'notify', {message: 'Goal', mode: 'full', theme: 'sport', group: false});
    assert.equal(r.code, 200);
    const list = await queued(s);
    assert.equal(list[0].wallpaper, 'theme:sport');
    const info = await call(s, 'GET', 'img?id=' + encodeURIComponent(list[0].id) + '&kind=wallpaper&info=1');
    assert.equal(info.json.type, 'image/svg+xml');
    const pic = await call(s, 'GET', 'img?id=' + encodeURIComponent(list[0].id) + '&kind=wallpaper');
    assert.equal(pic.code, 200);
    assert.equal(pic.headers['Content-Type'], 'image/svg+xml');
    assert.match(pic.text, /^<svg /);
    const rec = await call(s, 'GET', 'recent');
    assert.equal(rec.json.recent[0].theme, 'sport');
}));

test('a wallpaper URL wins over the theme; an unknown theme is ignored', () => withShard(async s => {
    await call(s, 'POST', 'notify', {message: 'own', mode: 'full', theme: 'news', wallpaper: 'http://127.0.0.1:9/own.png', group: false});
    await call(s, 'POST', 'notify', {message: 'bad one', mode: 'full', theme: 'cats', group: false});
    await call(s, 'POST', 'notify', {message: 'object', mode: 'full', theme: {toString: 1}, group: false});
    await call(s, 'POST', 'notify', {message: 'proto', mode: 'full', theme: '__proto__', group: false});
    const list = await queued(s);
    const by = text => list.find(n => n.message === text);
    assert.equal(by('own').wallpaper, 'http://127.0.0.1:9/own.png');
    assert.equal(by('bad one').wallpaper, '');
    assert.equal(by('object').wallpaper, '');
    assert.equal(by('proto').wallpaper, '');
}));

test('a source has a default theme; the sender can still choose another', () => withShard(async s => {
    assert.equal((await call(s, 'POST', 'profiles', {source: 'match-alerts', theme: 'sport'})).code, 200);
    assert.equal((await call(s, 'GET', 'profiles')).json.profiles['match-alerts'].theme, 'sport');
    await call(s, 'POST', 'notify', {message: 'from the source', source: 'match-alerts', mode: 'full', group: false});
    await call(s, 'POST', 'notify', {message: 'other theme', source: 'match-alerts', mode: 'full', theme: 'news', group: false});
    const list = await queued(s);
    assert.equal(list.find(n => n.message === 'from the source').wallpaper, 'theme:sport');
    assert.equal(list.find(n => n.message === 'other theme').wallpaper, 'theme:news');
    await call(s, 'POST', 'profiles', {source: 'match-alerts', theme: ''});
    assert.equal((await call(s, 'GET', 'profiles')).json.profiles['match-alerts'].theme, '');
    await call(s, 'POST', 'profiles', {source: 'match-alerts', theme: 'nope'});
    assert.equal((await call(s, 'GET', 'profiles')).json.profiles['match-alerts'].theme, '');
}));

test('the self-description lists the field and its values', () => withShard(async s => {
    const d = await call(s, 'GET', 'api');
    assert.deepEqual(d.json.fields.theme.enum.sort(), ['news', 'sport']);
}));
