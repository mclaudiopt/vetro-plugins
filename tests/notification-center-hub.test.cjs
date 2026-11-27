'use strict';
// The Notification Center as the hub: what a sender is told, the queues, replace and ttl, and who decides (sender or hub).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const {EventEmitter} = require('events');

const folder = path.join(__dirname, '../plugins/notification-center');
const create = require(path.join(folder, 'index.js'));
const rules = require(path.join(folder, 'rules.js'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withShard(fn, options = {}) {
    let config = {};
    const commands = [];
    const shard = create({
        id: 'notification-center', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-hub-')),
        config: {get: () => JSON.parse(JSON.stringify(config)), set: v => { config = JSON.parse(JSON.stringify(v)); }},
        queueFile: path.join(os.tmpdir(), 'nc-hub-q-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json'),
        overlay: {dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-hub-ovl-')), secondMs: options.secondMs || 0},
        sound: {gapMs: 0, waitMs: 0, songScale: 0.01},
        execute: cmd => { commands.push(cmd); return options.fail ? Promise.reject(new Error('no')) : Promise.resolve({exit_code: 0}); }
    });
    if (shard.start) shard.start();
    const call = (method, sub, body) => new Promise((resolve, reject) => {
        const req = new EventEmitter(), headers = {};
        req.method = method; req.url = '/' + sub; req.headers = {}; req.destroy = () => {};
        const res = {setHeader(k, v) { headers[k] = v; }, writeHead(code) { this.code = code; }, end(text) { let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ } resolve({code: this.code, json: j, headers}); }};
        if (!shard.route(req, res, sub.split('?')[0])) return reject(new Error('route not handled: ' + sub));
        setImmediate(() => { if (body != null) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
    });
    const send = body => call('POST', 'notify', Object.assign({message: 'hello', open: false, group: false}, body));
    const status = id => call('GET', 'notify-status?id=' + id);
    try { await fn({call, send, status, commands}); } finally { if (shard.stop) shard.stop(); }
}

test('the answer says what will happen and the status can be asked later', () => withShard(async ({send, status}) => {
    const r = await send({source: 'news', category: 'goal', mode: 'full', duration: 5});
    assert.equal(r.json.status, 'queued');
    assert.deepEqual(r.json.effective, {mode: 'full', sound: '', volume: 100, duration: 5});
    const s = await status(r.json.id);
    assert.deepEqual([s.json.status, s.json.source, s.json.category], ['queued', 'news', 'goal']);
    assert.equal((await status('99-zz')).code, 404);
}));

test('a full queue of urgent notifications refuses a normal one and says when to try again', () => withShard(async ({send, status}) => {
    for (let i = 0; i < 5; i++) await send({message: 'urgent ' + i, priority: 'high', mode: 'full'});
    const r = await send({mode: 'full', sound: 'chime'});
    assert.equal(r.code, 429);
    assert.equal(r.json.reason, 'queue full');
    assert.equal(r.headers['Retry-After'], '10');
    assert.equal((await status(r.json.id)).json.status, 'rejected');
}));

test('the bar shows one at a time and replace takes the place of the waiting one', () => withShard(async ({send, status, commands}) => {
    const a = await send({message: 'a', mode: 'overlay', open: true, duration: 20});
    const b = await send({message: 'b', mode: 'overlay', open: true, source: 'news', replace: 'm1'});
    const c = await send({message: 'c', mode: 'overlay', open: true, source: 'news', replace: 'm1'});
    assert.deepEqual([a.json.status, b.json.status, c.json.status], ['shown', 'queued', 'queued']);
    assert.equal(commands.length, 1);
    assert.equal((await status(b.json.id)).json.status, 'replaced');
    await wait(500);
    assert.equal(commands.length, 2);
    assert.equal((await status(c.json.id)).json.status, 'shown');
}, {secondMs: 5}));

test('a bar that waited longer than its ttl is not shown', () => withShard(async ({send, status, commands}) => {
    await send({mode: 'overlay', open: true, duration: 20});
    const late = await send({message: 'late', mode: 'overlay', open: true, ttl: 1, duration: 1});
    await wait(1700);
    assert.equal(commands.length, 1);
    assert.equal((await status(late.json.id)).json.status, 'expired');
}, {secondMs: 60}));

test('a bar that cannot start is reported', () => withShard(async ({send, status}) => {
    const r = await send({mode: 'overlay', open: true});
    await wait(20);
    assert.equal((await status(r.json.id)).json.status, 'failed');
}, {fail: true}));

test('the sender decides unless the source does not allow it; categories give defaults', () => withShard(async ({call, send}) => {
    await call('POST', 'profiles', {source: 'news', mode: 'banner', sound: 'soft', categories: {goal: {mode: 'overlay', sound: 'success', volume: 40}}});
    const free = await send({source: 'news', category: 'goal', mode: 'full'});
    assert.deepEqual([free.json.effective.mode, free.json.effective.sound, free.json.effective.volume], ['full', 'success', 40]);
    await call('POST', 'profiles', {source: 'news', allowMode: false, allowSound: false, allowUrgent: false});
    const held = await send({source: 'news', category: 'goal', mode: 'full', sound: 'alert', priority: 'high'});
    assert.deepEqual([held.json.effective.mode, held.json.effective.sound], ['overlay', 'success']);
    const other = await send({source: 'news', category: 'weather', mode: 'full', sound: 'alert'});
    assert.deepEqual([other.json.effective.mode, other.json.effective.sound], ['banner', 'soft']);
    assert.equal(rules.applyProfile({priority: 'high'}, rules.sanitizeProfile({allowUrgent: false}, v => v)).priority, undefined);
}));

test('senders announce themselves with their categories; a refused one is logged once with the reason', () => withShard(async ({call, send}) => {
    await send({source: 'epg-alerts', category: 'reminder'});
    await send({source: 'constructor'});
    const seen = (await call('GET', 'profiles')).json.seen;
    assert.deepEqual(seen['epg-alerts'].categories, ['reminder']);
    assert.ok(seen.constructor.at > 0);
    await call('POST', 'profiles', {source: 'constructor', delete: true});
    assert.ok(!Object.keys((await call('GET', 'profiles')).json.seen).includes('constructor'), 'delete removes it from the list');
    await call('POST', 'profiles', {source: 'epg-alerts', enabled: false});
    assert.equal((await send({source: 'epg-alerts'})).code, 403);
    await send({source: 'epg-alerts'});
    const log = (await call('GET', 'recent')).json.recent.filter(n => n.status === 'rejected');
    assert.equal(log.length, 1);
    assert.equal(log[0].reason, 'source is disabled');
}));

// The TV refuses an install request over 516 KiB (measured on Vetro: "request body exceeds 516 KiB").
test('the package is small enough for the TV to install', () => {
    const version = require(path.join(folder, 'manifest.json')).version;
    const bundle = path.join(__dirname, '../dist/notification-center-' + version + '.vplugin');
    if (fs.existsSync(bundle)) assert.ok(fs.statSync(bundle).size <= 516 * 1024, 'the package has ' + fs.statSync(bundle).size + ' bytes');
});

test('GET api lists the features',() => withShard(async ({call}) => {
    assert.deepEqual((await call('GET', 'api')).json.features, ['category', 'status', 'ttl', 'replace', 'policy', 'image2', 'highlight']);
}));

test('a sender stops being new once the panel opens it, without getting a profile', () => withShard(async ({call, send}) => {
    await send({source: 'epg-alerts', category: 'reminder'});
    const list = async () => (await call('GET', 'profiles')).json;
    assert.equal((await list()).seen['epg-alerts'].opened, false);
    const r = await call('POST', 'profiles', {source: 'epg-alerts', opened: true});
    assert.deepEqual([r.code, r.json.opened], [200, true]);
    const after = await list();
    assert.equal(after.seen['epg-alerts'].opened, true);
    assert.deepEqual(after.profiles, {});
    assert.equal((await call('POST', 'profiles', {source: 'nobody', opened: true})).json.opened, false);
    await call('POST', 'profiles', {source: 'epg-alerts', delete: true});
    await send({source: 'epg-alerts'});
    assert.equal((await list()).seen['epg-alerts'].opened, false);
}));

test('the key can come in the body and is never listed', () => withShard(async ({call, send}) => {
    await call('POST', 'profiles', {source: 'door', key: 'abcdefgh1234'});
    assert.equal((await send({source: 'door'})).code, 403);
    assert.equal((await send({source: 'door', key: 'abcdefgh1234'})).code, 200);
    assert.ok(!JSON.stringify((await call('GET', 'recent')).json).includes('abcdefgh1234'));
}));
