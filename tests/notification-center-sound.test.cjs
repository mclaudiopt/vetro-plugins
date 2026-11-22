'use strict';
// Sounds: a notification can ask for one of the TV's system sounds. The Shard has `exec` for exactly one command shape; a fake ctx.execute records
// every command, so these tests also prove that nothing from a request can reach it.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const {EventEmitter} = require('events');

const folder = path.join(__dirname, '../plugins/notification-center');
const create = require(path.join(folder, 'index.js'));
const rules = require(path.join(folder, 'rules.js'));
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const SHAPE = /^paplay --volume=\d{1,6} \/usr\/share\/feedback\/sound\/operation\/[a-z_]+\.wav$/;
const DIR = '/usr/share/feedback/sound/operation/';

function start(options = {}) {
    let config = options.seed || {};
    const commands = [];
    const ctx = {
        id: 'notification-center', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-sound-')),
        config: {get: () => JSON.parse(JSON.stringify(config)), set: v => { config = JSON.parse(JSON.stringify(v)); }},
        sound: {gapMs: options.gapMs === undefined ? 0 : options.gapMs}
    };
    if (options.execute !== null) {
        ctx.execute = cmd => {
            commands.push(cmd);
            if (options.execute) return options.execute(cmd);
            return Promise.resolve({exit_code: 0, stdout: '', stderr: ''});
        };
    }
    const shard = create(ctx);
    if (shard.start) shard.start();
    return {shard, commands};
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
    const s = start(options);
    try { await fn(s.shard, s.commands); } finally { if (s.shard.stop) s.shard.stop(); }
}
const vol = (percent, gain = 200) => Math.round(65536 * percent / 100 * gain / 100);

test('the manifest asks for exec, and only the sound command uses it', () => {
    assert.deepEqual(manifest.permissions, ['exec']);
});

test('a notification with a sound runs the one fixed command, with the volume and the boost', () => withShard(async (s, commands) => {
    const r = await call(s, 'POST', 'notify', {title: 'Goal', message: 'Sporting 1-0', sound: 'reward', volume: 80});
    assert.equal(r.code, 200);
    assert.equal(r.json.sound, 'requested');
    await wait(50);
    assert.deepEqual(commands, ['paplay --volume=' + vol(80) + ' ' + DIR + 'vi_reward.wav']);
}));

test('without a sound nothing is run (the default is silence)', () => withShard(async (s, commands) => {
    const r = await call(s, 'POST', 'notify', {message: 'quiet one'});
    assert.equal(r.json.sound, 'none');
    await wait(50);
    assert.deepEqual(commands, []);
}));

test('only names from the closed list are accepted; anything else is ignored and never reaches the command', () => withShard(async (s, commands) => {
    for (const bad of ['../../etc/passwd', 'Chime', '__proto__', 'constructor', 'chime; reboot', 'chime $(id)', {toString: 1}, ['chime'], 5, '', null]) {
        const r = await call(s, 'POST', 'notify', {message: 'x' + Math.random(), sound: bad});
        assert.equal(r.code, 200);
        assert.equal(r.json.sound, 'none', JSON.stringify(bad));
        assert.equal((await call(s, 'POST', 'play', {sound: bad})).code, 400, 'play ' + JSON.stringify(bad));
    }
    await wait(50);
    assert.deepEqual(commands, []);
}));

test('every command ever run has exactly the fixed shape, whatever the request sends', () => withShard(async (s, commands) => {
    const hostile = [500, 3, -1, 1e15, 'abc', '80; reboot', '$(id)', {toString: 1}, [1], null, true, NaN, '  60  ', 12.7];
    for (const sound of Object.keys(rules.SOUNDS)) for (const volume of hostile) await call(s, 'POST', 'notify', {message: sound + String(Math.random()), sound, volume});
    for (const volume of hostile) await call(s, 'POST', 'play', {sound: 'chime', volume});
    await call(s, 'POST', 'settings', {soundGain: '300; reboot'});
    await call(s, 'POST', 'settings', {soundGain: {toString: 1}});
    await wait(100);
    assert.ok(commands.length > 100, 'many sounds were played: ' + commands.length);
    for (const c of commands) assert.match(c, SHAPE);
}));

test('the volume is clamped to 10-100 and defaults to 100', () => withShard(async (s, commands) => {
    for (const volume of [500, 3, {toString: 1}, 50]) await call(s, 'POST', 'notify', {message: 'v' + String(Math.random()), sound: 'chime', volume});
    await wait(80);
    assert.deepEqual(commands.map(c => Number(/--volume=(\d+)/.exec(c)[1])), [vol(100), vol(100), vol(100), vol(50)]);
}));

test('the boost (soundGain) is a setting, 100-300 %, default 200', () => withShard(async (s, commands) => {
    assert.equal((await call(s, 'GET', 'settings')).json.settings.soundGain, 200);
    assert.equal((await call(s, 'POST', 'settings', {soundGain: 300})).json.settings.soundGain, 300);
    assert.equal((await call(s, 'POST', 'settings', {soundGain: 1000})).json.settings.soundGain, 300);
    assert.equal((await call(s, 'POST', 'settings', {soundGain: 50})).json.settings.soundGain, 100);
    assert.equal((await call(s, 'POST', 'settings', {soundGain: 'x'})).json.settings.soundGain, 100, 'an invalid value keeps the current one');
    await call(s, 'POST', 'settings', {soundGain: 300});
    assert.equal((await call(s, 'POST', 'settings', {strict: false})).json.settings.soundGain, 300, 'other settings keep it');
    await call(s, 'POST', 'notify', {message: 'loud', sound: 'alert'});
    await wait(50);
    assert.deepEqual(commands, ['paplay --volume=' + vol(100, 300) + ' ' + DIR + 'vi_fail.wav']);
}));

test('a source can have a default sound and volume, and the request can still choose another', () => withShard(async (s, commands) => {
    await call(s, 'POST', 'profiles', {source: 'match-alerts', sound: 'success', volume: 60});
    assert.equal((await call(s, 'GET', 'profiles')).json.profiles['match-alerts'].sound, 'success');
    await call(s, 'POST', 'notify', {message: 'goal', source: 'match-alerts'});
    await call(s, 'POST', 'notify', {message: 'red card', source: 'match-alerts', sound: 'alert', volume: 90});
    await wait(80);
    assert.deepEqual(commands, ['paplay --volume=' + vol(60) + ' ' + DIR + 'vi_success.wav', 'paplay --volume=' + vol(90) + ' ' + DIR + 'vi_fail.wav']);
    assert.equal((await call(s, 'POST', 'profiles', {source: 'match-alerts', sound: 'nope'})).json.profile.sound, '', 'an unknown sound clears it');
}));

test('webhooks and ntfy can choose a sound too', () => withShard(async (s, commands) => {
    await call(s, 'POST', 'hooks', {name: 'door', message: '{{who}} is at the door', sound: 'open'});
    await call(s, 'POST', 'hook/door', {who: 'Ana'});
    await call(s, 'POST', 'ntfy', 'Backup finished', {sound: 'soft', 'content-type': 'text/plain'});
    await call(s, 'POST', 'ntfy', JSON.stringify({message: 'Disk almost full', sound: 'alert', volume: 70}), {'content-type': 'application/json'});
    await wait(100);
    assert.deepEqual(commands.map(c => /operation\/(.+)\.wav/.exec(c)[1]), ['home_open', 'select', 'vi_fail']);
    assert.equal(Number(/--volume=(\d+)/.exec(commands[2])[1]), vol(70));
}));

test('no sound for a notification that is not shown: quiet hours, a repeat, a wrong key, a rate limit', () => withShard(async (s, commands) => {
    await call(s, 'POST', 'profiles', {source: 'locked', key: 'secret-key-123'});
    assert.equal((await call(s, 'POST', 'notify', {message: 'no key', source: 'locked', sound: 'chime'})).code, 403);
    await call(s, 'POST', 'profiles', {source: 'slow', rate: 1});
    await call(s, 'POST', 'notify', {message: 'first', source: 'slow'});
    assert.equal((await call(s, 'POST', 'notify', {message: 'second', source: 'slow', sound: 'chime'})).code, 429);
    await call(s, 'POST', 'notify', {message: 'same', sound: 'chime'});
    const again = await call(s, 'POST', 'notify', {message: 'same', sound: 'chime'});
    assert.equal(again.json.merged, true);
    assert.equal(again.json.sound, undefined);
    await wait(50);
    assert.equal(commands.length, 1, 'only the first "same" played');

    await call(s, 'POST', 'settings', {quiet: {enabled: true, from: '00:00', to: '23:59', allow: 'alert'}});
    if (new Date().getHours() === 23 && new Date().getMinutes() === 59) return;   // the one minute outside the window
    const quiet = await call(s, 'POST', 'notify', {message: 'shh', sound: 'chime', level: 'info'});
    assert.equal(quiet.json.suppressed, 'quiet hours');
    const loud = await call(s, 'POST', 'notify', {message: 'fire', sound: 'alert', level: 'alert'});
    assert.equal(loud.json.sound, 'requested');
    await wait(50);
    assert.equal(commands.length, 2);
    assert.match(commands[1], /vi_fail\.wav$/);
}));

test('Resend keeps the sound: it is stored with the recent notification', () => withShard(async (s) => {
    await call(s, 'POST', 'notify', {message: 'again', sound: 'chime', volume: 50, open: false});
    const rec = (await call(s, 'GET', 'recent')).json.recent[0];
    assert.equal(rec.sound, 'chime');
    assert.equal(rec.volume, 50);
}));

test('the notification still works when the command fails, exits with an error or throws', async () => {
    for (const execute of [
        () => Promise.reject(new Error('paplay: not found')),
        () => Promise.resolve({exit_code: 1, stderr: 'no audio'}),
        () => { throw new Error('exec denied'); },
        () => 'not a promise'
    ]) {
        await withShard(async (s) => {
            const r = await call(s, 'POST', 'notify', {message: 'still shown', sound: 'chime'});
            assert.equal(r.code, 200);
            assert.equal(r.json.sound, 'requested');
            await wait(50);
            assert.equal((await call(s, 'GET', 'sounds')).json.last.ok, false, 'the failure is visible in GET sounds');
            assert.equal((await call(s, 'GET', 'notifications')).json.notifications.length, 1);
        }, {execute});
    }
});

test('one sound every 0.8 s: faster requests are skipped, not queued', () => withShard(async (s, commands) => {
    const a = await call(s, 'POST', 'notify', {message: 'a', sound: 'chime'});
    const b = await call(s, 'POST', 'notify', {message: 'b', sound: 'chime'});
    assert.equal(a.json.sound, 'requested');
    assert.equal(b.json.sound, 'skipped');
    assert.equal((await call(s, 'POST', 'play', {sound: 'chime'})).code, 429);
    await wait(50);
    assert.equal(commands.length, 1);
}, {gapMs: 800}));

test('GET sounds lists the closed list and the boost; status says sounds are available; without exec they are not', async () => {
    await withShard(async (s) => {
        const r = await call(s, 'GET', 'sounds');
        assert.deepEqual(r.json.sounds, ['chime', 'soft', 'reward', 'success', 'alert', 'rotation', 'open', 'poweron']);
        assert.equal(r.json.available, true);
        assert.equal(r.json.gain, 200);
        assert.equal((await call(s, 'GET', 'status')).json.sound, true);
    });
    await withShard(async (s) => {
        assert.equal((await call(s, 'GET', 'sounds')).json.available, false);
        const r = await call(s, 'POST', 'notify', {message: 'no exec', sound: 'chime'});
        assert.equal(r.code, 200);
    }, {execute: null});
});

test('POST play plays a sound without a notification, and refuses unknown names', () => withShard(async (s, commands) => {
    const ok = await call(s, 'POST', 'play', {sound: 'poweron', volume: 40});
    assert.equal(ok.code, 200);
    assert.equal(ok.json.sound, 'requested');
    for (const bad of [{sound: 'nope'}, {sound: '../x'}, {sound: {toString: 1}}, [], null]) {
        assert.equal((await call(s, 'POST', 'play', bad)).code, 400, JSON.stringify(bad));
    }
    assert.equal((await call(s, 'POST', 'play', '{not json')).code, 400);
    await wait(50);
    assert.deepEqual(commands, ['paplay --volume=' + vol(40) + ' ' + DIR + 'power_on.wav']);
    assert.deepEqual((await call(s, 'GET', 'notifications')).json.notifications, [], 'no notification was queued');
}));

test('the Shard has no other use of exec: the only command string in the source is the paplay one', () => {
    const source = fs.readFileSync(path.join(folder, 'index.js'), 'utf8');
    const calls = source.match(/ctx\.execute\(/g) || [];
    assert.equal(calls.length, 1);
    assert.match(source, /ctx\.execute\('paplay --volume=' \+ v \+ ' ' \+ SOUND_DIR \+ SOUND_FILES\[name\]/);
    assert.deepEqual(Object.keys(rules.SOUNDS), ['chime', 'soft', 'reward', 'success', 'alert', 'rotation', 'open', 'poweron']);
    assert.ok(!fs.readFileSync(path.join(folder, 'rules.js'), 'utf8').includes('execute'));
});
