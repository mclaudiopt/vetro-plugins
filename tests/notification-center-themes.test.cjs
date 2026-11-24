'use strict';
// Wallpaper themes you add: a name and a picture address, next to the built-in sport and news.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const {EventEmitter} = require('events');

const folder = path.join(__dirname, '../plugins/notification-center');
const create = require(path.join(folder, 'index.js'));
const rules = require(path.join(folder, 'rules.js'));

function start(options = {}) {
    let config = options.seed || {};
    const ctx = {
        id: 'notification-center', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-themes-')),
        config: {get: () => JSON.parse(JSON.stringify(config)), set: v => { config = JSON.parse(JSON.stringify(v)); }},
        queueFile: path.join(os.tmpdir(), 'nc-q-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json'),
        sound: {gapMs: 0, waitMs: 0, songScale: 0.01, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-themes-snd-'))}
    };
    const shard = create(ctx);
    if (shard.start) shard.start();
    return shard;
}
function call(shard, method, sub, body) {
    return new Promise((resolve, reject) => {
        const req = new EventEmitter();
        req.method = method; req.url = '/' + sub; req.headers = {}; req.destroy = () => {};
        const res = {writeHead(code) { this.code = code; }, end(text) { let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ } resolve({code: this.code, json: j, text}); }};
        if (!shard.route(req, res, sub.split('?')[0])) return reject(new Error('route not handled: ' + method + ' ' + sub));
        setImmediate(() => { if (body != null) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); req.emit('end'); });
    });
}
async function withShard(fn, options) {
    const s = start(options);
    try { await fn(s); } finally { if (s.stop) s.stop(); }
}
const queued = async s => (await call(s, 'GET', 'notifications')).json.notifications;
const URL1 = 'https://example.com/derby.png';

test('without own themes there are only sport and news', () => withShard(async s => {
    const d = (await call(s, 'GET', 'themes')).json;
    assert.deepEqual(d, {builtin: ['sport', 'news'], custom: {}, max: 12});
}));

test('an own theme is listed, accepted as theme and its address becomes the wallpaper', () => withShard(async s => {
    const r = await call(s, 'POST', 'themes', {name: 'derby', url: URL1});
    assert.equal(r.code, 200);
    assert.deepEqual((await call(s, 'GET', 'themes')).json.custom, {derby: URL1});
    assert.ok((await call(s, 'GET', 'api')).json.fields.theme.enum.includes('derby'));
    await call(s, 'POST', 'notify', {message: 'derby day', mode: 'full', theme: 'derby', group: false});
    await call(s, 'POST', 'notify', {message: 'built-in', mode: 'full', theme: 'sport', group: false});
    await call(s, 'POST', 'notify', {message: 'own wallpaper wins', mode: 'full', theme: 'derby', wallpaper: 'https://example.com/own.png', group: false});
    const list = await queued(s), by = m => list.find(n => n.message === m);
    assert.equal(by('derby day').wallpaper, URL1);
    assert.equal(by('built-in').wallpaper, 'theme:sport');
    assert.equal(by('own wallpaper wins').wallpaper, 'https://example.com/own.png');
    assert.equal((await call(s, 'GET', 'recent')).json.recent.find(n => n.message === 'derby day').theme, 'derby');
}));

test('a source can have an own theme as its default', () => withShard(async s => {
    await call(s, 'POST', 'themes', {name: 'derby', url: URL1});
    assert.equal((await call(s, 'POST', 'profiles', {source: 'match-alerts', theme: 'derby'})).json.profile.theme, 'derby');
    await call(s, 'POST', 'notify', {message: 'from the source', source: 'match-alerts', mode: 'full', group: false});
    assert.equal((await queued(s))[0].wallpaper, URL1);
    assert.equal((await call(s, 'POST', 'profiles', {source: 'match-alerts', theme: 'nope'})).json.profile.theme, 'derby', 'an unknown theme is ignored: the source keeps the one it has');
    assert.equal((await call(s, 'POST', 'profiles', {source: 'match-alerts', theme: ''})).json.profile.theme, '', 'an empty value clears it');
}));

test('only well-named themes with an http(s) address are accepted', () => withShard(async s => {
    const bad = async (body) => { const r = await call(s, 'POST', 'themes', body); assert.equal(r.code, 400, JSON.stringify(body) + ' -> ' + r.text); };
    for (const name of ['sport', 'news', 'Upper', '../x', 'a b', '__proto__', 'constructor!', '', 'x'.repeat(25)]) await bad({name, url: URL1});
    for (const url of ['javascript:alert(1)', 'ftp://example.com/x.png', 'file:///etc/passwd', '', 'x'.repeat(300), {toString: 1}, null, 'example.com/x.png']) await bad({name: 'ok', url});
    await bad({url: URL1});
    assert.deepEqual((await call(s, 'GET', 'themes')).json.custom, {});
    assert.deepEqual(Object.keys(rules.CUSTOM_THEMES), []);
}));

test('at most 12 own themes; replacing one is fine; delete frees a place; a deleted theme is ignored', () => withShard(async s => {
    for (let i = 0; i < 12; i++) assert.equal((await call(s, 'POST', 'themes', {name: 't' + i, url: 'https://example.com/' + i + '.png'})).code, 200);
    assert.equal((await call(s, 'POST', 'themes', {name: 't12', url: URL1})).code, 400);
    assert.equal((await call(s, 'POST', 'themes', {name: 't3', url: 'https://example.com/new.png'})).code, 200);
    assert.equal((await call(s, 'GET', 'themes')).json.custom.t3, 'https://example.com/new.png');
    assert.equal((await call(s, 'POST', 'themes', {name: 't0', delete: true})).code, 200);
    assert.equal((await call(s, 'POST', 'themes', {name: 't0', delete: true})).code, 404);
    assert.equal((await call(s, 'POST', 'themes', {name: 't12', url: URL1})).code, 200);
    await call(s, 'POST', 'notify', {message: 'ghost', mode: 'full', theme: 't0', group: false});
    assert.equal((await queued(s))[0].wallpaper, '', 'a deleted theme gives no wallpaper');
}));

test('own themes survive a restart (they are read from the configuration)', async () => {
    const seed = {themes: {derby: URL1, 'Bad Name': URL1, sport: URL1, evil: 'javascript:alert(1)'}};
    await withShard(async s => {
        assert.deepEqual((await call(s, 'GET', 'themes')).json.custom, {derby: URL1});
    }, {seed});
});

test('the setup file carries the themes; a hostile file adds only valid ones', () => withShard(async a => {
    await call(a, 'POST', 'themes', {name: 'derby', url: URL1});
    const file = (await call(a, 'GET', 'export')).text;
    assert.deepEqual(JSON.parse(file).themes, {derby: URL1});
    await withShard(async b => {
        const r = await call(b, 'POST', 'import', file);
        assert.equal(r.json.imported.themes, 1);
        assert.deepEqual((await call(b, 'GET', 'themes')).json.custom, {derby: URL1});
        const raw = '{"format":"notification-center-setup","formatVersion":1,"themes":{"fine":"' + URL1 + '","sport":"' + URL1 + '","Bad":"' + URL1 + '","js":"javascript:alert(1)","__proto__":"' + URL1 + '"}}';
        const r2 = await call(b, 'POST', 'import', raw);
        assert.equal(r2.code, 200, r2.text);
        assert.deepEqual(Object.keys((await call(b, 'GET', 'themes')).json.custom).sort(), ['derby', 'fine']);
        assert.ok(r2.json.skipped.length >= 3);
    });
}));
