'use strict';
// Your own sounds: upload a WAV, use its name as `sound`. The only command is still paplay; a name is validated and must be a file of the sounds folder.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const {EventEmitter} = require('events');

const folder = path.join(__dirname, '../plugins/notification-center');
const create = require(path.join(folder, 'index.js'));
const rules = require(path.join(folder, 'rules.js'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// A small PCM WAV made here: `seconds` of a quiet tone.
function wav({seconds = 0.2, rate = 22050, channels = 1, bits = 16, format = 1} = {}) {
    const dataLen = Math.round(seconds * rate) * channels * (bits / 8);
    const b = Buffer.alloc(44 + dataLen);
    b.write('RIFF', 0); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8); b.write('fmt ', 12);
    b.writeUInt32LE(16, 16); b.writeUInt16LE(format, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate * channels * (bits / 8), 28); b.writeUInt16LE(channels * (bits / 8), 32); b.writeUInt16LE(bits, 34);
    b.write('data', 36); b.writeUInt32LE(dataLen, 40);
    for (let i = 0; i < dataLen / 2; i++) b.writeInt16LE(Math.round(3000 * Math.sin(i / 8)), 44 + i * 2);
    return b;
}
function start() {
    let config = {};
    const commands = [], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-own-'));
    const ctx = {
        id: 'notification-center', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-own-shard-')),
        config: {get: () => JSON.parse(JSON.stringify(config)), set: v => { config = JSON.parse(JSON.stringify(v)); }},
        queueFile: path.join(os.tmpdir(), 'nc-q-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json'),
        sound: {gapMs: 0, waitMs: 0, songScale: 0.01, dir},
        execute: cmd => { commands.push(cmd); return Promise.resolve({exit_code: 0, stdout: '', stderr: ''}); }
    };
    const shard = create(ctx);
    if (shard.start) shard.start();
    return {shard, commands, dir};
}
// `sub` may carry a query (?name=...): the route gets the path, the request keeps the whole URL, as Vetro does.
function call(shard, method, sub, body) {
    return new Promise((resolve, reject) => {
        const req = new EventEmitter();
        req.method = method; req.url = '/' + sub; req.headers = {}; req.destroy = () => {};
        const res = {writeHead(code) { this.code = code; }, end(text) { let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ } resolve({code: this.code, json: j, text}); }};
        if (!shard.route(req, res, sub.split('?')[0])) return reject(new Error('route not handled: ' + method + ' ' + sub));
        setImmediate(() => {
            if (body != null) {
                if (Buffer.isBuffer(body)) { for (let i = 0; i < body.length; i += 16384) req.emit('data', body.slice(i, i + 16384)); }
                else req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
            }
            req.emit('end');
        });
    });
}
async function withShard(fn) {
    const s = start();
    try { await fn(s.shard, s.commands, s.dir); } finally { if (s.shard.stop) s.shard.stop(); }
}
const SHAPE = dir => new RegExp('^paplay --volume=\\d{1,6} ' + dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[/\\\\][a-z0-9-]{1,24}\\.wav$');

test('an uploaded WAV becomes a sound: listed, playable by name, and played with the one paplay command', () => withShard(async (s, commands, dir) => {
    const up = await call(s, 'POST', 'sound-upload?name=goal', wav({seconds: 1.5}));
    assert.equal(up.code, 200);
    assert.deepEqual([up.json.name, up.json.seconds], ['goal', 1.5]);
    assert.ok(fs.existsSync(path.join(dir, 'goal.wav')));
    const list = (await call(s, 'GET', 'sounds')).json;
    assert.ok(list.sounds.includes('goal') && list.sounds.includes('chime'));
    assert.deepEqual(list.custom, ['goal']);
    const r = await call(s, 'POST', 'notify', {message: 'GOAL!', sound: 'goal', volume: 80, group: false});
    assert.equal(r.json.sound, 'requested');
    await wait(60);
    assert.equal(commands.length, 1);
    assert.match(commands[0], SHAPE(dir));
    assert.ok(commands[0].endsWith('goal.wav'));
    const played = await call(s, 'POST', 'play', {sound: 'goal'});
    assert.equal(played.code, 200);
    const d = await call(s, 'GET', 'api');
    assert.ok(d.json.enums.sound.includes('goal'));
}));

test('a source and a webhook can have an own sound as their default', () => withShard(async s => {
    await call(s, 'POST', 'sound-upload?name=whistle', wav());
    assert.equal((await call(s, 'POST', 'profiles', {source: 'match-alerts', sound: 'whistle'})).json.profile.sound, 'whistle');
    await call(s, 'POST', 'hooks', {name: 'w', message: 'x', sound: 'whistle'});
    assert.equal((await call(s, 'GET', 'hooks')).json.hooks.w.sound, 'whistle');
    assert.equal((await call(s, 'POST', 'profiles', {source: 'match-alerts', sound: 'nope'})).json.profile.sound, '');
}));

test('only well-named, sane WAV files are accepted; nothing else reaches the sounds folder', () => withShard(async (s, commands, dir) => {
    const bad = async (name, body, code = 400) => { const r = await call(s, 'POST', 'sound-upload?name=' + name, body); assert.equal(r.code, code, name + ' -> ' + r.text); };
    await bad('../etc/passwd', wav());
    await bad('a%2fb', wav());
    await bad('Goal', wav());                 // capital letter
    await bad('', wav());
    await bad('x'.repeat(25), wav());
    await bad('chime', wav());                // the name of a built-in sound
    await bad('__proto__', wav());
    await bad('ok', Buffer.from('not a wav at all, just text'.repeat(5)));
    await bad('ok', wav({bits: 8}));
    await bad('ok', wav({format: 3}));        // float, not PCM
    await bad('ok', wav({channels: 6}));
    await bad('ok', wav({rate: 96000}));
    await bad('ok', wav({seconds: 12}));      // longer than 10 s
    assert.equal((await call(s, 'POST', 'sound-upload?name=big', Buffer.alloc(1048577, 1))).code, 413);
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.deepEqual(rules.CUSTOM, {});
    assert.equal(commands.length, 0);
}));

test('at most 12 own sounds; delete frees a place; a name that is not a file cannot be played', () => withShard(async (s, commands) => {
    for (let i = 0; i < 12; i++) assert.equal((await call(s, 'POST', 'sound-upload?name=s' + i, wav({seconds: 0.1}))).code, 200);
    assert.equal((await call(s, 'POST', 'sound-upload?name=s12', wav({seconds: 0.1}))).code, 400);
    assert.equal((await call(s, 'POST', 'sound-upload?name=s3', wav({seconds: 0.1}))).code, 200, 'replacing one is fine');
    assert.equal((await call(s, 'POST', 'sound-delete', {name: 's0'})).code, 200);
    assert.equal((await call(s, 'POST', 'sound-delete', {name: 's0'})).code, 404);
    assert.equal((await call(s, 'POST', 'sound-delete', {name: '../x'})).code, 404);
    assert.equal((await call(s, 'POST', 'sound-upload?name=s12', wav({seconds: 0.1}))).code, 200);
    const r = await call(s, 'POST', 'notify', {message: 'ghost', sound: 's0', group: false});
    assert.equal(r.json.sound, 'none');
    assert.equal((await call(s, 'POST', 'play', {sound: 's0'})).code, 400);
    await wait(30);
    assert.equal(commands.length, 0);
}));

test('own sounds survive a restart of the Shard (they are read from the folder)', () => withShard(async (s) => {
    await call(s, 'POST', 'sound-upload?name=keep', wav());
    rules.CUSTOM.stale = 1;                      // what a previous run could have left in memory
    if (s.start) s.start();                      // start() reads the folder again
    assert.deepEqual(Object.keys(rules.CUSTOM), ['keep']);
}));
