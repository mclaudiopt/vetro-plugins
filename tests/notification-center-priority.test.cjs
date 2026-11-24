'use strict';
// Priority (high goes first, ignores quiet hours, is never merged) and the button of the full-screen card (action, POST action?id=).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const {EventEmitter} = require('events');

const folder = path.join(__dirname, '../plugins/notification-center');
const create = require(path.join(folder, 'index.js'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function start(options = {}) {
    let config = options.seed || {};
    const ctx = {
        id: 'notification-center', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-prio-')),
        config: {get: () => JSON.parse(JSON.stringify(config)), set: v => { config = JSON.parse(JSON.stringify(v)); }},
        queueFile: path.join(os.tmpdir(), 'nc-q-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json'),
        sound: {gapMs: 0, waitMs: 0, songScale: 0.01}
    };
    if (options.vetro) ctx.vetro = options.vetro;
    const shard = create(ctx);
    if (shard.start) shard.start();
    return shard;
}
function call(shard, method, sub, body, headers) {
    return new Promise((resolve, reject) => {
        const req = new EventEmitter();
        req.method = method; req.url = '/' + sub; req.headers = headers || {}; req.destroy = () => {};
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
const send = (s, over) => call(s, 'POST', 'notify', Object.assign({mode: 'full', group: false}, over));

test('a high-priority notification goes to the front of the queue', () => withShard(async s => {
    await send(s, {message: 'A'});
    await send(s, {message: 'B'});
    await send(s, {message: 'C', priority: 'high'});
    const list = await queued(s);
    assert.deepEqual(list.map(n => n.message), ['C', 'A', 'B']);
    assert.equal(list[0].priority, 'high');
    assert.equal(list[1].priority, '');
}));

test('quiet hours hold back a normal notification, not a high one', () => withShard(async s => {
    const quiet = await call(s, 'POST', 'settings', {quiet: {enabled: true, from: '00:00', to: '23:59', allow: 'none'}});
    assert.equal(quiet.code, 200);
    const normal = await send(s, {message: 'normal one'});
    const urgent = await send(s, {message: 'urgent one', priority: 'high'});
    assert.equal(normal.json.suppressed, 'quiet hours');
    assert.equal(urgent.json.suppressed, undefined);
    assert.deepEqual((await queued(s)).map(n => n.message), ['urgent one']);
}));

test('a repeat is merged, unless it is high priority', () => withShard(async s => {
    const first = await call(s, 'POST', 'notify', {message: 'same', mode: 'full'});
    const second = await call(s, 'POST', 'notify', {message: 'same', mode: 'full'});
    assert.equal(second.json.merged, true);
    assert.ok(first.json.id);
    const a = await call(s, 'POST', 'notify', {message: 'urgent same', mode: 'full', priority: 'high'});
    const b = await call(s, 'POST', 'notify', {message: 'urgent same', mode: 'full', priority: 'high'});
    assert.equal(a.json.merged, undefined);
    assert.equal(b.json.merged, undefined);
    assert.equal((await queued(s)).filter(n => n.message === 'urgent same').length, 2);
}));

test('when the queue is full the oldest normal one is dropped; five high ones fill it', () => withShard(async s => {
    for (let i = 1; i <= 5; i++) await send(s, {message: 'n' + i});
    await send(s, {message: 'H1', priority: 'high'});
    let list = (await queued(s)).map(n => n.message);
    assert.deepEqual(list, ['H1', 'n2', 'n3', 'n4', 'n5']);
    for (let i = 2; i <= 5; i++) await send(s, {message: 'H' + i, priority: 'high'});
    list = (await queued(s)).map(n => n.message);
    assert.equal(list.length, 5);
    assert.ok(list.every(m => /^H/.test(m)), 'only high ones are left: ' + list.join(','));
    await send(s, {message: 'late normal'});
    assert.ok(!(await queued(s)).some(n => n.message === 'late normal'), 'with the queue full of high ones a normal one has no place');
    assert.equal((await queued(s)).length, 5);
}));

test('a source can have a default priority; the sender can still say normal', () => withShard(async s => {
    assert.equal((await call(s, 'POST', 'profiles', {source: 'match-alerts', priority: 'high'})).code, 200);
    assert.equal((await call(s, 'GET', 'profiles')).json.profiles['match-alerts'].priority, 'high');
    await send(s, {message: 'from the source', source: 'match-alerts'});
    await send(s, {message: 'sender says normal', source: 'match-alerts', priority: 'normal'});
    const list = await queued(s);
    assert.equal(list.find(n => n.message === 'from the source').priority, 'high');
    assert.equal(list.find(n => n.message === 'sender says normal').priority, '');
    await call(s, 'POST', 'profiles', {source: 'match-alerts', priority: ''});
    assert.equal((await call(s, 'GET', 'profiles')).json.profiles['match-alerts'].priority, '');
    await call(s, 'POST', 'profiles', {source: 'match-alerts', priority: {toString: 1}});
    assert.equal((await call(s, 'GET', 'profiles')).json.profiles['match-alerts'].priority, '');
}));

test('ntfy priority 5 (urgent) is high priority; 4 is not', () => withShard(async s => {
    await call(s, 'POST', 'ntfy', 'routine', {priority: '4', 'content-type': 'text/plain'});
    await call(s, 'POST', 'ntfy', 'urgent', {priority: '5', 'content-type': 'text/plain'});
    const list = await queued(s);
    assert.equal(list[0].message, 'urgent');
    assert.equal(list[0].priority, 'high');
    assert.equal(list.find(n => n.message === 'routine').priority, '');
}));

test('an action keeps only an app id and a short label', () => withShard(async s => {
    await send(s, {message: 'ok', action: {app: '9Ur5IzDKqV.TizenYouTube', label: 'Open YouTube'}});
    await send(s, {message: 'default label', action: {app: 'abc.Def'}});
    await send(s, {message: 'long label', action: {app: 'abc.Def', label: 'x'.repeat(60) + '\n\u0001'}});
    const bads = [{app: '../x'}, {app: 'a b'}, {app: 'a;b'}, {app: {toString: 1}}, {app: ''}, 'string', ['abc'], {label: 'only a label'}];
    for (let i = 0; i < bads.length; i++) await send(s, {message: 'bad ' + i, action: bads[i]});
    const all = (await call(s, 'GET', 'recent')).json.recent;
    const rec = m => all.find(n => n.message === m);
    assert.equal(rec('ok').action, 'Open YouTube');
    assert.equal(rec('default label').action, 'Open');
    assert.ok(rec('long label').action.length <= 24 && !/[\u0000-\u001f]/.test(rec('long label').action));
    for (let i = 0; i < bads.length; i++) assert.equal(rec('bad ' + i).action, '', 'a bad action is dropped, the notification is still shown: ' + i);
    const list = await queued(s);
    assert.ok(list.every(n => n.action === null || Object.keys(n.action).join() === 'label'), 'the app id is never sent back to the screen');
}));

test('the card sees only the label; POST action?id= launches the app the notification named', async () => {
    const launched = [];
    const vetro = http.createServer((req, res) => {
        let b = ''; req.on('data', d => { b += d; });
        req.on('end', () => { launched.push(req.method + ' ' + req.url + ' ' + b); res.writeHead(200); res.end('{}'); });
    });
    await new Promise(r => vetro.listen(0, '127.0.0.1', r));
    try {
        await withShard(async s => {
            const r = await send(s, {message: 'press me', action: {app: '9Ur5IzDKqV.TizenYouTube', label: 'Open YouTube'}});
            const n = (await queued(s))[0];
            assert.deepEqual(n.action, {label: 'Open YouTube'});
            assert.equal(r.code, 200);
            const go = await call(s, 'POST', 'action?id=' + encodeURIComponent(n.id) + '&app=evil.App');
            assert.equal(go.code, 200);
            assert.equal(go.json.app, '9Ur5IzDKqV.TizenYouTube');
            await wait(100);
            // the card itself is launched too (mode full); what counts is that the app of the action was opened once, and the one named in the query never
            assert.deepEqual(launched.filter(l => /TizenYouTube/.test(l)), ['POST /apps/launch {"appId":"9Ur5IzDKqV.TizenYouTube"}']);
            assert.ok(!launched.some(l => /evil/.test(l)));
            assert.equal((await call(s, 'POST', 'action?id=' + encodeURIComponent(n.id))).code, 429, 'used again at once');
            assert.equal((await call(s, 'POST', 'action?id=nope')).code, 404);
            assert.equal((await call(s, 'POST', 'action')).code, 404);
            await send(s, {message: 'no button'});
            const plain = (await queued(s)).find(x => x.message === 'no button');
            assert.equal(plain.action, null);
            assert.equal((await call(s, 'POST', 'action?id=' + encodeURIComponent(plain.id))).code, 404);
        }, {vetro: {host: '127.0.0.1', port: vetro.address().port}});
    } finally { vetro.close(); }
});

test('the self-description lists the two fields and the route', () => withShard(async s => {
    const d = (await call(s, 'GET', 'api')).json;
    assert.deepEqual(d.fields.priority.enum.slice().sort(), ['high', 'normal']);
    assert.equal(d.fields.action.type, 'object');
    assert.ok(d.endpoints.some(e => e.path === 'action?id=<id>'));
}));
