'use strict';
// app/js/app.js: the screen app asks the TV for its own address and loads nt.js from it (127.0.0.1 is the last try).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');

const folder = path.join(__dirname, '../plugins/notification-center/app');
const code = fs.readFileSync(path.join(folder, 'js/app.js'), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs app.js against a fake page. `scripts` collects every script the app adds; each one "fails" at once (onerror), so the app tries the next address.
function run({webapis, tizen, failAll = true} = {}) {
    const scripts = [], log = [];
    const el = () => ({children: [], appendChild(c) { this.children.push(c); }});
    const logEl = el();
    const head = {appendChild(s) { scripts.push(s.src); if (failAll && s.onerror) setImmediate(() => s.onerror()); }};
    const document = {
        getElementById: () => logEl, head, documentElement: head,
        createElement: () => ({set textContent(t) { log.push(t); }, onerror: null, src: ''})
    };
    const window = {webapis, tizen};
    const sandbox = {window, document, setTimeout, Date, parseInt, console};
    vm.runInNewContext(code, sandbox);
    return {scripts, log, logEl};
}
const systeminfo = map => ({systeminfo: {getPropertyValue(kind, ok, err) { setImmediate(() => { if (map[kind] === undefined) err(new Error('none')); else ok({ipAddress: map[kind]}); }); }}});
const NT = '/plugins/notification-center/api/nt.js';

test('the wired address of the TV is tried first, then 127.0.0.1', async () => {
    const r = run({tizen: systeminfo({ETHERNET_NETWORK: '192.168.1.50'})});
    await wait(250);
    assert.deepEqual(r.scripts.map(s => s.split('?')[0]), ['http://192.168.1.50:8099' + NT, 'http://127.0.0.1:8099' + NT]);
    assert.equal(r.log[r.log.length - 1], 'Could not load nt.js from the Shard. Is it running?');
});

test('without a cable the wireless address is used', async () => {
    const r = run({tizen: systeminfo({WIFI_NETWORK: '10.0.0.7'})});
    await wait(250);
    assert.equal(r.scripts[0].split('?')[0], 'http://10.0.0.7:8099' + NT);
});

test('the Samsung network API wins when it answers', async () => {
    const r = run({webapis: {network: {getIp: () => '192.168.5.9'}}, tizen: systeminfo({ETHERNET_NETWORK: '192.168.1.50'})});
    await wait(250);
    assert.equal(r.scripts[0].split('?')[0], 'http://192.168.5.9:8099' + NT);
});

test('with no network information only 127.0.0.1 is tried', async () => {
    const none = run({});
    const noRead = run({tizen: systeminfo({})});
    await wait(250);
    assert.deepEqual(none.scripts.map(s => s.split('?')[0]), ['http://127.0.0.1:8099' + NT]);
    assert.deepEqual(noRead.scripts.map(s => s.split('?')[0]), ['http://127.0.0.1:8099' + NT]);
});

test('only a plain IPv4 address of the TV is accepted; text from the system can not become an address', async () => {
    const bad = ['evil.example.com/x', '192.168.1.1:80/x', '999.1.1.1', '0.0.0.0', '127.0.0.1', '10.0.0.1/../x', '', null, 12345, {toString: () => '10.0.0.1'}, '10.0.0'];
    for (const value of bad) {
        const r = run({tizen: systeminfo({ETHERNET_NETWORK: value, WIFI_NETWORK: value})});
        await wait(120);
        assert.deepEqual(r.scripts.map(s => s.split('?')[0]), ['http://127.0.0.1:8099' + NT], 'rejected: ' + String(value));
    }
});

test('the first address that works stops the search', async () => {
    const r = run({tizen: systeminfo({ETHERNET_NETWORK: '192.168.1.50'}), failAll: false});
    await wait(250);
    assert.equal(r.scripts.length, 1);
    assert.equal(r.log.length, 0);
});

test('the manifest asks for the privilege and the version of the new app', () => {
    const cfg = fs.readFileSync(path.join(folder, 'config.xml'), 'utf8');
    assert.match(cfg, /version="0\.2\.3"/);
    assert.match(cfg, /privilege\/systeminfo/);
    assert.match(cfg, /<access origin="\*"/);
});
