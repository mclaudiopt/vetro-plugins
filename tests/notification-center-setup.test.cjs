'use strict';
// Copy the setup to another TV: GET export makes one JSON file, POST import loads it back through the same checks as every other route.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const {EventEmitter} = require('events');

const folder = path.join(__dirname, '../plugins/notification-center');
const create = require(path.join(folder, 'index.js'));
const rules = require(path.join(folder, 'rules.js'));

function wav(seconds = 0.2) {
    const rate = 22050, dataLen = Math.round(seconds * rate) * 2, b = Buffer.alloc(44 + dataLen);
    b.write('RIFF', 0); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8); b.write('fmt ', 12);
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(dataLen, 40);
    return b;
}
function start() {
    let config = {};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-setup-'));
    const ctx = {
        id: 'notification-center', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-setup-shard-')),
        config: {get: () => JSON.parse(JSON.stringify(config)), set: v => { config = JSON.parse(JSON.stringify(v)); }},
        queueFile: path.join(os.tmpdir(), 'nc-q-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json'),
        sound: {gapMs: 0, waitMs: 0, songScale: 0.01, dir},
        execute: () => Promise.resolve({exit_code: 0, stdout: '', stderr: ''})
    };
    const shard = create(ctx);
    if (shard.start) shard.start();
    return {shard, dir};
}
function call(shard, method, sub, body) {
    return new Promise((resolve, reject) => {
        const req = new EventEmitter();
        req.method = method; req.url = '/' + sub; req.headers = {}; req.destroy = () => {};
        const res = {
            writeHead(code, headers) { this.code = code; this.headers = headers || {}; },
            end(data) { const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || ''); let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ } resolve({code: this.code, headers: this.headers, json: j, text}); }
        };
        if (!shard.route(req, res, sub.split('?')[0])) return reject(new Error('route not handled: ' + method + ' ' + sub));
        setImmediate(() => {
            if (body != null) {
                const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
                for (let i = 0; i < buf.length; i += 16384) req.emit('data', buf.slice(i, i + 16384));
            }
            req.emit('end');
        });
    });
}
async function withShards(fn) {
    const a = start(), b = start();
    try { await fn(a.shard, b.shard, a.dir, b.dir); } finally { if (a.shard.stop) a.shard.stop(); if (b.shard.stop) b.shard.stop(); }
}
async function fill(s) {
    await call(s, 'POST', 'settings', {groupSeconds: 15, soundVolume: 60, overlayOpacity: 70, strict: true});
    await call(s, 'POST', 'sound-upload?name=golo', wav(1));
    await call(s, 'POST', 'profiles', {source: 'match-alerts', level: 'ok', mode: 'overlay', theme: 'sport', sound: 'golo', volume: 80, key: 'secret-key-1234'});
    await call(s, 'POST', 'hooks', {name: 'github', title: '{{repository.name}}', message: '{{pusher.name}} pushed', level: 'info'});
}

test('the export is one JSON file: settings, sources without keys, webhooks, no sounds', () => withShards(async (a) => {
    await fill(a);
    const r = await call(a, 'GET', 'export');
    assert.equal(r.code, 200);
    assert.match(r.headers['Content-Disposition'], /attachment; filename="notification-center-setup\.json"/);
    const d = r.json;
    assert.equal(d.format, 'notification-center-setup');
    assert.equal(d.formatVersion, 1);
    assert.equal(d.keysIncluded, false);
    assert.equal(d.settings.soundVolume, 60);
    assert.equal(d.settings.overlayOpacity, 70);
    assert.equal(d.sources['match-alerts'].theme, 'sport');
    assert.equal('key' in d.sources['match-alerts'], false);
    assert.equal('hasKey' in d.sources['match-alerts'], false);
    assert.equal(d.webhooks.github.message, '{{pusher.name}} pushed');
    assert.deepEqual(d.sounds, {});
    assert.ok(!r.text.includes('secret-key-1234'));
}));

test('keys=1 adds the keys of the senders and sounds=1 adds the own sounds', () => withShards(async (a) => {
    await fill(a);
    const d = (await call(a, 'GET', 'export?sounds=1&keys=1')).json;
    assert.equal(d.keysIncluded, true);
    assert.equal(d.sources['match-alerts'].key, 'secret-key-1234');
    assert.deepEqual(Object.keys(d.sounds), ['golo']);
    assert.deepEqual(Buffer.from(d.sounds.golo, 'base64'), wav(1));
}));

test('a full export loads on another TV: settings, sources with their key, webhooks and sounds', () => withShards(async (a, b, adir, bdir) => {
    await fill(a);
    const file = (await call(a, 'GET', 'export?sounds=1&keys=1')).text;
    const r = await call(b, 'POST', 'import', file);
    assert.equal(r.code, 200, r.text);
    assert.deepEqual(r.json.imported, {settings: true, sources: 1, webhooks: 1, sounds: 1, themes: 0});
    assert.deepEqual(r.json.skipped, []);
    assert.equal((await call(b, 'GET', 'settings')).json.settings.soundVolume, 60);
    const p = (await call(b, 'GET', 'profiles')).json.profiles['match-alerts'];
    assert.deepEqual([p.theme, p.sound, p.volume, p.hasKey], ['sport', 'golo', 80, true]);
    assert.equal((await call(b, 'GET', 'hooks')).json.hooks.github.level, 'info');
    assert.deepEqual((await call(b, 'GET', 'sounds')).json.custom, ['golo']);
    assert.ok(fs.existsSync(path.join(bdir, 'golo.wav')));
}));

test('a file without keys keeps the key a source already has', () => withShards(async (a, b) => {
    await fill(a);
    await call(b, 'POST', 'profiles', {source: 'match-alerts', key: 'other-key-5678'});
    const file = (await call(a, 'GET', 'export?sounds=1')).text;   // no keys in it
    await call(b, 'POST', 'import', file);
    const exported = (await call(b, 'GET', 'export?keys=1')).json;
    assert.equal(exported.sources['match-alerts'].key, 'other-key-5678');
    assert.equal(exported.sources['match-alerts'].theme, 'sport');
}));

test('only a real setup file is read, and each part is checked again', () => withShards(async (a, b, adir, bdir) => {
    assert.equal((await call(b, 'POST', 'import', 'not json at all')).code, 400);
    assert.equal((await call(b, 'POST', 'import', {format: 'something-else', formatVersion: 1})).code, 400);
    assert.equal((await call(b, 'POST', 'import', {format: 'notification-center-setup', formatVersion: 2})).code, 400);
    const hostile = {
        format: 'notification-center-setup', formatVersion: 1,
        settings: {soundVolume: 9999, overlayOpacity: {toString: 1}, groupSeconds: '99999', quiet: {enabled: true, from: 'xx', to: '07:00', allow: 'evil'}},
        sources: {'__proto__': {level: 'ok'}, '../x': {level: 'ok'}, 'fine': {level: 'nope', mode: 'overlay', sound: '../../etc/passwd', volume: 5, theme: 'cats', key: 'k'}},
        webhooks: {'bad name': {message: 'x'}, ok: {message: ''}, good: {message: 'm', sound: 'nope', mode: 'full'}},
        sounds: {'../evil': Buffer.from('x').toString('base64'), chime: wav().toString('base64'), junk: Buffer.from('not a wav').toString('base64'), fine: wav().toString('base64')}
    };
    const r = await call(b, 'POST', 'import', hostile);
    assert.equal(r.code, 200, r.text);
    assert.deepEqual(r.json.imported, {settings: true, sources: 1, webhooks: 1, sounds: 1, themes: 0});
    assert.ok(r.json.skipped.length >= 6);
    const s = (await call(b, 'GET', 'settings')).json.settings;
    assert.equal(s.soundVolume, 100);
    assert.equal(s.overlayOpacity, 88);
    assert.equal(s.quiet.allow, 'alert');
    const profiles = (await call(b, 'GET', 'profiles')).json.profiles;
    assert.deepEqual(Object.keys(profiles), ['fine']);
    assert.deepEqual([profiles.fine.level, profiles.fine.mode, profiles.fine.sound, profiles.fine.theme, profiles.fine.hasKey], ['', 'overlay', '', '', false]);
    assert.deepEqual(Object.keys((await call(b, 'GET', 'hooks')).json.hooks), ['good']);
    assert.equal((await call(b, 'GET', 'hooks')).json.hooks.good.sound, '');
    assert.deepEqual(fs.readdirSync(bdir), ['fine.wav']);
    assert.deepEqual(Object.keys(rules.CUSTOM), ['fine']);
}));

test('a real __proto__ key in the file (hand-written JSON) stores nothing', () => withShards(async (a, b, adir, bdir) => {
    const raw = '{"format":"notification-center-setup","formatVersion":1,"sources":{"__proto__":{"level":"ok"},"constructor":{"level":"ok"},"fine":{"mode":"full"}},'
        + '"webhooks":{"__proto__":{"message":"x"}},"sounds":{"__proto__":"AAAA"},"settings":{"__proto__":{"strict":true}}}';
    const r = await call(b, 'POST', 'import', raw);
    assert.equal(r.code, 200, r.text);
    // `constructor` is a valid source name (names are looked up with hasOwnProperty, as through POST profiles); `__proto__` is never stored
    assert.equal(r.json.imported.sources, 2);
    assert.equal(r.json.imported.webhooks, 0);
    assert.equal(r.json.imported.sounds, 0);
    assert.deepEqual(Object.keys((await call(b, 'GET', 'profiles')).json.profiles).sort(), ['constructor', 'fine']);
    assert.equal(Object.getPrototypeOf((await call(b, 'GET', 'profiles')).json.profiles), Object.prototype);
    assert.deepEqual(Object.keys((await call(b, 'GET', 'hooks')).json.hooks), []);
    assert.equal(({}).strict, undefined, 'Object.prototype was not touched');
    assert.equal((await call(b, 'GET', 'settings')).json.settings.strict, false);
}));

test('a file over 12 MB is refused', () => withShards(async (a, b) => {
    const r = await call(b, 'POST', 'import', Buffer.alloc(12582913, 32));
    assert.equal(r.code, 413);
}));

test('GET apps gives only the visible apps of the TV, and an empty list when Vetro does not answer', async () => {
    const http = require('http');
    const vetro = http.createServer((q, r) => r.end(JSON.stringify({apps: [
        {appId: 'a.visible', name: 'Visible', show: true}, {appId: 'b.hidden', name: 'Hidden', show: false}, {appId: 'bad id', show: true}, null]})));
    await new Promise(ok => vetro.listen(0, '127.0.0.1', ok));
    const port = vetro.address().port;
    const shard = create({id: 'notification-center', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-apps-')), config: {get: () => ({}), set: () => {}},
        queueFile: path.join(os.tmpdir(), 'nc-q-apps-' + process.pid + '.json'), vetro: {port}});
    try {
        assert.deepEqual((await call(shard, 'GET', 'apps')).json, {apps: [{appId: 'a.visible', name: 'Visible'}]});
        await new Promise(ok => vetro.close(ok));
        assert.deepEqual((await call(shard, 'GET', 'apps')).json, {apps: []});
    } finally { if (shard.stop) shard.stop(); vetro.close(() => {}); }
});

test('the panel calls only relative addresses and does not rely on downloads', () => {
    const ui = fs.readFileSync(path.join(folder, 'ui.html'), 'utf8');
    assert.doesNotMatch(ui, /fetch\(\s*["']\//);
    assert.doesNotMatch(ui, /createObjectURL|\.download\s*=/);
});

test('the self-description lists both routes and the Cast routes are gone',() => withShards(async (a) => {
    const d = (await call(a, 'GET', 'api')).json, paths = d.endpoints.map(e => e.path);
    assert.ok(paths.some(p => /^export/.test(p)));
    assert.ok(paths.includes('import'));
    assert.ok(!paths.some(p => /cast/.test(p)));
    const gone = await call(a, 'POST', 'cast', {message: 'x'}).catch(e => e);
    assert.ok(gone instanceof Error, 'the route cast does not exist any more');
}));
