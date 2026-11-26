'use strict';
// One banner, not two: the Shard marks a banner `svc` while the banner service reports, and the app screen (nt.js) then does not post it again.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const {EventEmitter} = require('events');

const folder = path.join(__dirname, '../plugins/notification-center');
const create = require(path.join(folder, 'index.js'));
const ntCode = fs.readFileSync(path.join(folder, 'nt.js'), 'utf8');

async function withShard(fn) {
    let config = {};
    const shard = create({
        id: 'notification-center', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-svc-')),
        config: {get: () => JSON.parse(JSON.stringify(config)), set: v => { config = JSON.parse(JSON.stringify(v)); }},
        queueFile: path.join(os.tmpdir(), 'nc-svc-q-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json'),
        execute: () => Promise.resolve({exit_code: 0})
    });
    if (shard.start) shard.start();
    const call = (method, sub, body) => new Promise((resolve, reject) => {
        const req = new EventEmitter();
        req.method = method; req.url = '/' + sub; req.headers = {}; req.destroy = () => {};
        const res = {setHeader() {}, writeHead(code) { this.code = code; }, end(text) { resolve({code: this.code, json: JSON.parse(text)}); }};
        if (!shard.route(req, res, sub.split('?')[0])) return reject(new Error('route not handled: ' + sub));
        setImmediate(() => { if (body != null) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
    });
    const send = mode => call('POST', 'notify', {message: mode, mode, open: false, group: false});
    const svc = async () => Object.fromEntries((await call('GET', 'notifications')).json.notifications.map(n => [n.mode, n.svc]));
    try { await fn({call, send, svc}); } finally { if (shard.stop) shard.stop(); }
}

// Runs nt.js on a fake page whose queue is `list`; returns the bodies of the banners it posted.
function appScreen(list) {
    const posted = [];
    const el = () => ({style: {setProperty() {}}, childNodes: [], firstChild: null, appendChild(c) { this.firstChild = this.firstChild || c; return c; },
        removeChild() {}, getElementsByTagName: () => [{}], focus() {}});
    const byId = {ncl: el()};
    const document = {head: el(), body: el(), documentElement: el(), visibilityState: 'visible', currentScript: null,
        getElementById: id => byId[id] || null, createElement: el, addEventListener() {}};
    function Notification(title, options) { posted.push(options.body); }
    Notification.permission = 'granted';
    function XMLHttpRequest() {}
    XMLHttpRequest.prototype = {open() {}, send() { this.status = 200; this.responseText = JSON.stringify({lang: 'en', notifications: list}); this.onload(); }};
    const store = {};
    vm.runInNewContext(ntCode, {window: {Notification}, Notification, XMLHttpRequest, document,
        localStorage: {getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }},
        setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, Image: function () {}});
    return posted;
}

test('without a report from the banner service no banner is marked svc', () => withShard(async ({send, svc}) => {
    await send('banner');
    assert.deepEqual(await svc(), {banner: false});
}));

test('after a report only banners are marked, and the mark ends when the service is silent for 10 minutes', () => withShard(async ({call, send, svc}) => {
    for (const mode of ['banner', 'full', 'both']) await send(mode);
    assert.equal((await call('POST', 'service-report', {stage: 'queue'})).code, 200);
    assert.deepEqual(await svc(), {banner: true, full: false, both: false});
    const real = Date.now;
    try {
        const later = real() + 600001;
        Date.now = () => later;
        await send('banner');
        assert.equal((await svc()).banner, false);
    } finally { Date.now = real; }
}));

test('a report that is refused does not count as a living service', () => withShard(async ({call, send, svc}) => {
    await send('banner');
    assert.equal((await call('POST', 'service-report', {nothing: 1})).code, 400);
    assert.deepEqual(await svc(), {banner: false});
}));

test('the app screen does not post a banner marked svc, and posts the others', () => {
    const note = (id, mode, svc) => ({id, title: id, message: id, level: 'info', mode, duration: 5, icon: '', svc});
    assert.deepEqual(appScreen([note('by-service', 'banner', true), note('by-app', 'banner', false), note('card', 'full', false), note('card-and-banner', 'both', false)]),
        ['by-app', 'card-and-banner']);
});

test('from the Shard to the screen: no second banner while the service reports', () => withShard(async ({call, send}) => {
    await send('banner');
    const queue = async () => (await call('GET', 'notifications?src=app')).json.notifications;
    assert.deepEqual(appScreen(await queue()), ['banner']);
    await call('POST', 'service-report', {stage: 'posted'});
    assert.deepEqual(appScreen(await queue()), []);
}));
