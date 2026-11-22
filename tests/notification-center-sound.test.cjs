'use strict';
// The sound field: a notification can ask for one of the notification-sound Shard's sounds. A fake Vetro records what the Shard asks it to do.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const {EventEmitter} = require('events');

const folder = path.join(__dirname, '../plugins/notification-center');
const create = require(path.join(folder, 'index.js'));
const rules = require(path.join(folder, 'rules.js'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Vetro stand-in: records /apps/launch and sound calls; `installed` decides whether the sound Shard answers.
async function fakeVetro(options = {}) {
    const log = {plays: [], launches: [], states: 0};
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => {
            if (req.url === '/apps/launch') { log.launches.push(JSON.parse(body || '{}').appId); res.writeHead(200); return res.end('{}'); }
            if (req.url === '/plugins/notification-sound/api/state') { log.states += 1; res.writeHead(options.installed === false ? 404 : 200); return res.end('{}'); }
            if (req.url === '/plugins/notification-sound/api/play') {
                log.plays.push(JSON.parse(body || '{}'));
                res.writeHead(options.playStatus || 200); return res.end('{"ok":true}');
            }
            res.writeHead(404); res.end('{}');
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {log, port: server.address().port, close: () => new Promise(resolve => server.close(resolve))};
}
function start(port, seed) {
    let config = seed || {};
    const shard = create({
        id: 'notification-center', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-sound-')),
        config: {get: () => JSON.parse(JSON.stringify(config)), set: v => { config = JSON.parse(JSON.stringify(v)); }},
        execute: () => Promise.reject(new Error('no exec')), vetro: {host: '127.0.0.1', port}
    });
    if (shard.start) shard.start();
    return shard;
}
function call(shard, method, sub, body, headers) {
    return new Promise((resolve, reject) => {
        const req = new EventEmitter();
        req.method = method; req.url = '/' + sub; req.headers = headers || {}; req.destroy = () => {};
        const res = {writeHead(code) { this.code = code; }, end(text) { let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ } resolve({code: this.code, json: j, text}); }};
        if (!shard.route(req, res, sub)) return reject(new Error('route not handled: ' + method + ' ' + sub));
        setImmediate(() => { if (body != null) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); req.emit('end'); });
    });
}
async function withShard(fn, options, seed) {
    const vetro = await fakeVetro(options), shard = start(vetro.port, seed);
    try { await fn(shard, vetro.log); } finally { if (shard.stop) shard.stop(); await vetro.close(); }
}

test('a notification with a sound asks the sound Shard to play it, with the volume', () => withShard(async (s, log) => {
    const r = await call(s, 'POST', 'notify', {title: 'Goal', message: 'Sporting 1-0', sound: 'reward', volume: 80});
    assert.equal(r.code, 200);
    assert.equal(r.json.sound, 'requested');
    await wait(150);
    assert.deepEqual(log.plays, [{sound: 'reward', volume: 80}]);
    assert.deepEqual(log.launches, ['NotifCtr01.Svc'], 'the banner is still requested');
}));

test('without a sound nothing is played (the default is silence)', () => withShard(async (s, log) => {
    const r = await call(s, 'POST', 'notify', {message: 'quiet one'});
    assert.equal(r.json.sound, 'none');
    await wait(150);
    assert.deepEqual(log.plays, []);
}));

test('only names from the closed list are accepted; anything else is ignored', () => withShard(async (s, log) => {
    for (const bad of ['../../etc/passwd', 'Chime', '__proto__', 'constructor', {toString: 1}, ['chime'], 5, '']) {
        const r = await call(s, 'POST', 'notify', {message: 'x' + Math.random(), sound: bad});
        assert.equal(r.code, 200);
        assert.equal(r.json.sound, 'none', JSON.stringify(bad));
    }
    await wait(150);
    assert.deepEqual(log.plays, []);
}));

test('the volume is clamped to 10-100 and left out when invalid', () => withShard(async (s, log) => {
    await call(s, 'POST', 'notify', {message: 'a', sound: 'chime', volume: 500});
    await call(s, 'POST', 'notify', {message: 'b', sound: 'chime', volume: 3});
    await call(s, 'POST', 'notify', {message: 'c', sound: 'chime', volume: {toString: 1}});
    await wait(200);
    assert.deepEqual(log.plays.map(p => p.volume), [100, undefined, undefined]);
}));

test('a source can have a default sound and volume, and the request can still choose another', () => withShard(async (s, log) => {
    await call(s, 'POST', 'profiles', {source: 'match-alerts', sound: 'success', volume: 60});
    assert.equal((await call(s, 'GET', 'profiles')).json.profiles['match-alerts'].sound, 'success');
    await call(s, 'POST', 'notify', {message: 'goal', source: 'match-alerts'});
    await call(s, 'POST', 'notify', {message: 'red card', source: 'match-alerts', sound: 'alert', volume: 90});
    await wait(200);
    assert.deepEqual(log.plays, [{sound: 'success', volume: 60}, {sound: 'alert', volume: 90}]);
    assert.equal((await call(s, 'POST', 'profiles', {source: 'match-alerts', sound: 'nope'})).json.profile.sound, '', 'an unknown sound clears it');
}));

test('webhooks and ntfy can choose a sound too', () => withShard(async (s, log) => {
    await call(s, 'POST', 'hooks', {name: 'door', message: '{{who}} is at the door', sound: 'open'});
    await call(s, 'POST', 'hook/door', {who: 'Ana'});
    await call(s, 'POST', 'ntfy', 'Backup finished', {sound: 'soft', 'content-type': 'text/plain'});
    await call(s, 'POST', 'ntfy', JSON.stringify({message: 'Disk almost full', sound: 'alert', volume: 70}), {'content-type': 'application/json'});
    await wait(250);
    assert.deepEqual(log.plays.map(p => p.sound), ['open', 'soft', 'alert']);
    assert.equal(log.plays[2].volume, 70);
}));

test('no sound for a notification that is not shown: quiet hours, a repeat, a wrong key, a rate limit', () => withShard(async (s, log) => {
    await call(s, 'POST', 'profiles', {source: 'locked', key: 'secret-key-123'});
    assert.equal((await call(s, 'POST', 'notify', {message: 'no key', source: 'locked', sound: 'chime'})).code, 403);
    await call(s, 'POST', 'profiles', {source: 'slow', rate: 1});
    await call(s, 'POST', 'notify', {message: 'first', source: 'slow'});
    assert.equal((await call(s, 'POST', 'notify', {message: 'second', source: 'slow', sound: 'chime'})).code, 429);
    await call(s, 'POST', 'notify', {message: 'same', sound: 'chime'});
    const again = await call(s, 'POST', 'notify', {message: 'same', sound: 'chime'});
    assert.equal(again.json.merged, true);
    assert.equal(again.json.sound, undefined);
    await wait(200);
    assert.equal(log.plays.length, 1, 'only the first "same" played');

    await call(s, 'POST', 'settings', {quiet: {enabled: true, from: '00:00', to: '23:59', allow: 'alert'}});
    if (new Date().getHours() === 23 && new Date().getMinutes() === 59) return;   // the one minute outside the window
    const quiet = await call(s, 'POST', 'notify', {message: 'shh', sound: 'chime', level: 'info'});
    assert.equal(quiet.json.suppressed, 'quiet hours');
    const loud = await call(s, 'POST', 'notify', {message: 'fire', sound: 'alert', level: 'alert'});
    assert.equal(loud.json.sound, 'requested');
    await wait(200);
    assert.equal(log.plays.length, 2);
    assert.equal(log.plays[1].sound, 'alert');
}));

test('Resend keeps the sound: it is stored with the recent notification', () => withShard(async (s) => {
    await call(s, 'POST', 'notify', {message: 'again', sound: 'chime', volume: 50, open: false});
    const rec = (await call(s, 'GET', 'recent')).json.recent[0];
    assert.equal(rec.sound, 'chime');
    assert.equal(rec.volume, 50);
}));

test('the notification still works when Vetro is down or the sound Shard fails', async () => {
    const dead = await fakeVetro(); const port = dead.port; await dead.close();
    const s = start(port);
    try {
        const r = await call(s, 'POST', 'notify', {message: 'no Vetro', sound: 'chime'});
        assert.equal(r.code, 200);
        assert.equal(r.json.sound, 'requested');
        assert.equal((await call(s, 'GET', 'status')).code, 200);
    } finally { if (s.stop) s.stop(); }
    await withShard(async (sh, log) => {
        assert.equal((await call(sh, 'POST', 'notify', {message: 'too soon', sound: 'chime'})).code, 200);
        await wait(150);
        assert.equal(log.plays.length, 1);
        const sounds = await call(sh, 'GET', 'sounds');
        assert.equal(sounds.json.last.ok, false, 'the failure is visible in GET sounds');
    }, {playStatus: 502});
});

test('GET sounds lists the closed list and says whether the sound Shard is installed; status says it too', async () => {
    await withShard(async (s) => {
        const r = await call(s, 'GET', 'sounds');
        assert.deepEqual(r.json.sounds, ['chime', 'soft', 'reward', 'success', 'alert', 'rotation', 'open', 'poweron']);
        assert.equal(r.json.installed, true);
        assert.equal((await call(s, 'GET', 'status')).json.sound, true);
    });
    await withShard(async (s) => {
        assert.equal((await call(s, 'GET', 'sounds')).json.installed, false);
        assert.equal((await call(s, 'GET', 'status')).json.sound, false);
    }, {installed: false});
});

test('the list matches the notification-sound Shard (when its folder is next to this repository)', t => {
    const file = path.join(__dirname, '../../tv-notification-sound/index.js');
    if (!fs.existsSync(file)) return t.skip('the sound Shard is not checked out here');
    const m = /var SOUNDS = \{([^}]*)\}/.exec(fs.readFileSync(file, 'utf8'));
    const names = m[1].split(',').map(x => x.split(':')[0].trim()).filter(Boolean);
    assert.deepEqual(Object.keys(rules.SOUNDS), names);
});

test('POST play plays a sound without a notification, and refuses unknown names', () => withShard(async (s, log) => {
    const ok = await call(s, 'POST', 'play', {sound: 'poweron', volume: 40});
    assert.equal(ok.code, 200);
    assert.equal(ok.json.sound, 'requested');
    for (const bad of [{sound: 'nope'}, {sound: '../x'}, {sound: {toString: 1}}, {}, [], null]) {
        assert.equal((await call(s, 'POST', 'play', bad)).code, 400, JSON.stringify(bad));
    }
    assert.equal((await call(s, 'POST', 'play', '{not json')).code, 400);
    await wait(150);
    assert.deepEqual(log.plays, [{sound: 'poweron', volume: 40}]);
    assert.deepEqual((await call(s, 'GET', 'notifications')).json.notifications, [], 'no notification was queued');
}));
