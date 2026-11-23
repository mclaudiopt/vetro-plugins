'use strict';
// The optional Cast bridge: one notification to every TV of the network, through the Cast Shard on the same TV. A fake Vetro plays the Cast Shard.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const {EventEmitter} = require('events');

const folder = path.join(__dirname, '../plugins/notification-center');
const create = require(path.join(folder, 'index.js'));

// Cast stand-in. options.installed=false answers 404 like a Vetro without the Cast Shard; options.results is what /cast answers.
async function fakeVetro(options = {}) {
    const log = {casts: [], launches: 0};
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => {
            if (req.url === '/apps/launch') { log.launches += 1; res.writeHead(200); return res.end('{}'); }
            if (options.installed === false) { res.writeHead(404); return res.end('{"error":"no such plugin"}'); }
            if (req.url === '/plugins/cast/api/state') {
                res.writeHead(200, {'Content-Type': 'application/json'});
                return res.end(JSON.stringify({tvs: options.tvs || [{id: 'a', name: 'Living room', group: 'house'}, {id: 'b', name: 'Bedroom', group: 'house'}, {id: 'c', name: 'Office', group: ''}], log: []}));
            }
            if (req.url === '/plugins/cast/api/cast') {
                log.casts.push(JSON.parse(body || '{}'));
                res.writeHead(options.castStatus || 200, {'Content-Type': 'application/json'});
                return res.end(JSON.stringify(options.castBody || {results: options.results || [{id: 'a', name: 'Living room', ok: true}, {id: 'b', name: 'Bedroom', ok: false, error: 'timeout'}]}));
            }
            res.writeHead(404); res.end('{}');
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {log, port: server.address().port, close: () => new Promise(resolve => server.close(resolve))};
}
function start(port) {
    let config = {};
    const shard = create({
        id: 'notification-center', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-cast-')),
        config: {get: () => JSON.parse(JSON.stringify(config)), set: v => { config = JSON.parse(JSON.stringify(v)); }},
        execute: () => Promise.reject(new Error('no exec')), vetro: {host: '127.0.0.1', port},
        queueFile: path.join(os.tmpdir(), 'nc-q-cast-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json')
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
async function withShard(fn, options) {
    const vetro = await fakeVetro(options), shard = start(vetro.port);
    try { await fn(shard, vetro.log); } finally { if (shard.stop) shard.stop(); await vetro.close(); }
}

test('GET cast says whether the Cast Shard is installed, how many TVs it knows and the groups', async () => {
    await withShard(async (s) => {
        const r = await call(s, 'GET', 'cast');
        assert.equal(r.code, 200);
        assert.deepEqual(r.json, {installed: true, tvs: 3, groups: ['house']});
    });
    await withShard(async (s) => {
        assert.deepEqual((await call(s, 'GET', 'cast')).json, {installed: false, tvs: 0, groups: []});
    }, {installed: false});
});

test('POST cast forwards only the fields Cast understands, cleaned, and reports how many TVs got it', () => withShard(async (s, log) => {
    const r = await call(s, 'POST', 'cast', {title: 'Dinner', message: 'It is ready', icon: '\u{1F355}', level: 'ok', mode: 'both', duration: 12, group: 'house', sound: 'reward', image: 'http://x.test/a.png', wallpaper: 'http://x.test/b.png', source: 'kitchen', open: false});
    assert.equal(r.code, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.sent, 1);
    assert.equal(r.json.failed, 1);
    assert.deepEqual(r.json.results.map(x => [x.id, x.ok, x.error]), [['a', true, ''], ['b', false, 'timeout']]);
    assert.deepEqual(log.casts, [{message: 'It is ready', title: 'Dinner', icon: '\u{1F355}', level: 'ok', mode: 'both', duration: 12, group: 'house'}]);
    assert.equal(log.launches, 0, 'nothing is queued or shown here: the TVs get it from Cast');
    assert.deepEqual((await call(s, 'GET', 'notifications')).json.notifications, []);
}));

test('POST cast accepts tvIds, limits them and refuses what is not a message', () => withShard(async (s, log) => {
    await call(s, 'POST', 'cast', {message: 'two TVs', tvIds: ['a', 'c', {toString: 1}, '', 'x'.repeat(100)].concat(Array.from({length: 40}, (_, i) => 't' + i))});
    assert.ok(log.casts[0].tvIds.length <= 20);
    assert.deepEqual(log.casts[0].tvIds.slice(0, 3), ['a', 'c', 'x'.repeat(40)]);
    assert.equal((await call(s, 'POST', 'cast', {title: 'no message'})).code, 400);
    assert.equal((await call(s, 'POST', 'cast', '{not json')).code, 400);
    assert.equal(log.casts.length, 1, 'nothing was forwarded for the invalid requests');
}));

test('POST cast goes through the same sender checks as notify (key, on/off, rate limit, strict mode)', () => withShard(async (s, log) => {
    await call(s, 'POST', 'profiles', {source: 'door', key: 'door-key-12345'});
    assert.equal((await call(s, 'POST', 'cast', {message: 'x', source: 'door'})).code, 403);
    assert.equal((await call(s, 'POST', 'cast', {message: 'x', source: 'door'}, {'x-nc-key': 'door-key-12345'})).code, 200);
    await call(s, 'POST', 'profiles', {source: 'noisy', rate: 1});
    assert.equal((await call(s, 'POST', 'cast', {message: 'a', source: 'noisy'})).code, 200);
    assert.equal((await call(s, 'POST', 'cast', {message: 'b', source: 'noisy'})).code, 429);
    await call(s, 'POST', 'profiles', {source: 'off', enabled: false});
    assert.equal((await call(s, 'POST', 'cast', {message: 'c', source: 'off'})).code, 403);
    await call(s, 'POST', 'settings', {strict: true});
    assert.equal((await call(s, 'POST', 'cast', {message: 'd'})).code, 403);
    assert.equal(log.casts.length, 2, 'only the two allowed ones reached Cast');
}));

test('a source default (icon, level) applies to cast too', () => withShard(async (s, log) => {
    await call(s, 'POST', 'profiles', {source: 'house', icon: '\u{1F3E0}', level: 'warn'});
    await call(s, 'POST', 'cast', {message: 'from a source', source: 'house'});
    assert.equal(log.casts[0].icon, '\u{1F3E0}');
    assert.equal(log.casts[0].level, 'warn');
}));

test('without the Cast Shard, or when Cast fails, the answer is a clear error and nothing breaks', async () => {
    await withShard(async (s) => {
        const r = await call(s, 'POST', 'cast', {message: 'nobody home'});
        assert.equal(r.code, 502);
        assert.match(r.json.error, /Cast Shard is not installed/);
    }, {installed: false});
    await withShard(async (s) => {
        const r = await call(s, 'POST', 'cast', {message: 'x'});
        assert.equal(r.code, 400);
        assert.equal(r.json.error, 'no TV to send to');
        assert.equal(r.json.ok, false);
    }, {castStatus: 400, castBody: {error: 'no TV to send to'}});
    const dead = await fakeVetro(); const port = dead.port; await dead.close();
    const s = start(port);
    try {
        assert.equal((await call(s, 'POST', 'cast', {message: 'no Vetro'})).code, 502);
        assert.equal((await call(s, 'GET', 'cast')).json.installed, false);
        assert.equal((await call(s, 'POST', 'notify', {message: 'still works', open: false})).code, 200);
    } finally { if (s.stop) s.stop(); }
});

test('hostile values in a cast request never throw', () => withShard(async (s) => {
    for (const bad of [{toString: 1}, [], null, true, 1e15, {length: 1e15}, '\u0000x', 'y'.repeat(5000)]) {
        for (const field of ['message', 'title', 'icon', 'level', 'mode', 'duration', 'group', 'tvIds', 'source', 'key']) {
            const r = await call(s, 'POST', 'cast', JSON.stringify({message: 'ok', [field]: bad}));
            assert.ok(r.code === 200 || r.code === 400 || r.code === 403 || r.code === 413, field + ' => ' + r.code + ' ' + r.text);
        }
    }
    assert.equal((await call(s, 'POST', 'cast', {message: 'still alive'})).code, 200);
}));
