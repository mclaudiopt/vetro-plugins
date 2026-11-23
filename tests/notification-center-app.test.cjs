'use strict';
// nt.js is the logic of the full-screen companion app (it runs inside the app on the TV). It is loaded here in an isolated context with a minimal fake DOM,
// a fake XMLHttpRequest, Image, Notification, localStorage and tizen, and a clock the test moves by hand, so the 8 second stay takes no time.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../plugins/notification-center/nt.js'), 'utf8');

function makeEnv(options = {}) {
    const env = {nextId: 1, posts: [], exits: 0, innerHTMLs: [], requests: [], scripts: [], images: [], timers: [], clock: 0, storage: {}, queue: options.queue || [], lang: 'en'};
    function el(tag) {
        const e = {
            tagName: String(tag).toUpperCase(), children: [], style: {setProperty(k, v) { this[k] = v; }}, className: '', _text: '', _html: '', parentNode: null, id: '',
            get childNodes() { return this.children; }, get firstChild() { return this.children[0] || null; },
            appendChild(c) {
                if (c.parentNode) c.parentNode.removeChild(c);
                c.parentNode = this; this.children.push(c);
                if (c.tagName === 'SCRIPT' && c.src) env.scripts.push(c);
                return c;
            },
            removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
            getElementsByTagName(t) { const out = []; (function walk(n) { n.children.forEach(ch => { if (ch.tagName === t.toUpperCase()) out.push(ch); walk(ch); }); })(this); return out; },
            set textContent(v) { this._text = String(v); this.children = []; },
            get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
            set innerHTML(v) {
                this._html = String(v); this.children = []; env.innerHTMLs.push(String(v));
                if (/<h1><\/h1><p><\/p><div id="ncl"><\/div>/.test(v)) { ['h1', 'p'].forEach(t => this.appendChild(el(t))); const d = el('div'); d.id = 'ncl'; this.appendChild(d); }
            },
            get innerHTML() { return this._html; }
        };
        return e;
    }
    env.body = el('body'); env.head = el('head');
    const log = el('div'); log.id = 'log'; env.body.appendChild(log);
    const listeners = {};
    const doc = {
        createElement: el, head: env.head, body: env.body, documentElement: el('html'), visibilityState: 'visible',
        currentScript: {src: options.scriptSrc || 'http://127.0.0.1:8099/plugins/notification-center/api/nt.js?t=1'},
        getElementById(id) { let found = null; (function walk(n) { if (n.id === id) found = n; n.children.forEach(walk); })(env.body); return found; },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
    };
    env.fire = (type, event) => (listeners[type] || []).forEach(fn => fn(event || {}));
    function XHR() {
        this.open = (m, url) => { this.url = url; };
        this.send = () => {
            env.requests.push(this.url);
            if (options.xhrFails) { return this.onerror && this.onerror(); }
            this.status = 200; this.responseText = JSON.stringify({lang: env.lang, notifications: env.queue});
            this.onload();
        };
    }
    function Img() { env.images.push(this); Object.defineProperty(this, 'src', {set: v => { this._src = v; }, get: () => this._src}); }
    const ctx = {
        document: doc, XMLHttpRequest: XHR, Image: Img, Date, JSON, parseInt, String, Math, encodeURIComponent, Object, Array,
        localStorage: {getItem: k => (k in env.storage ? env.storage[k] : null), setItem: (k, v) => { env.storage[k] = String(v); }},
        Notification: function (title, opts) { env.posts.push({title, body: opts && opts.body}); },
        tizen: {application: {getCurrentApplication: () => ({exit() { env.exits += 1; }})}},
        setTimeout(fn, ms) { const t = {fn, at: env.clock + (ms || 0), id: env.nextId++}; env.timers.push(t); return t.id; },
        clearTimeout(id) { env.timers = env.timers.filter(t => t.id !== id); },
        setInterval(fn, ms) { const t = {fn, at: env.clock + ms, every: ms, id: env.nextId++}; env.timers.push(t); return t.id; }
    };
    ctx.Notification.permission = 'granted';
    ctx.window = ctx;
    env.ctx = ctx;
    env.advance = ms => {
        const end = env.clock + ms;
        for (;;) {
            const due = env.timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0];
            if (!due) break;
            env.clock = due.at;
            if (due.every) due.at += due.every; else env.timers = env.timers.filter(t => t !== due);
            due.fn();
        }
        env.clock = end;
    };
    env.card = () => env.body.children.find(c => c.id === 'nc');
    env.cardTexts = () => { const host = doc.getElementById('ncl'); return host ? host.children.map(c => c.textContent) : []; };
    env.logLines = () => log.children.map(c => c.textContent);
    env.run = () => vm.runInNewContext(source, ctx, {filename: 'nt.js'});
    return env;
}
const note = (over) => Object.assign({id: 'n1', title: 'Oven', message: 'Dinner is ready', level: 'ok', mode: 'banner', duration: 8, icon: '', image: '', wallpaper: ''}, over);

test('banner mode: posts the native notification once, keeps the card hidden, stays for the duration and then leaves', () => {
    const env = makeEnv({queue: [note({icon: '\u{1F355}'})]});
    env.run();
    assert.deepEqual(env.posts, [{title: '\u{1F355} Oven', body: 'Dinner is ready'}]);
    assert.equal(env.card().style.display, 'none', 'no full-screen card for a banner');
    env.advance(7000);
    assert.equal(env.exits, 0, 'still there while the banner is on screen');
    env.advance(2000);
    assert.equal(env.exits, 1, 'left after the duration (the goodbye image answers or 600 ms pass)');
    assert.ok(env.images.some(i => /src=app&bye=1/.test(i._src || '')), 'the Shard is told the app left');
});

test('the same notification is not posted twice (the ids seen are kept)', () => {
    const env = makeEnv({queue: [note()]});
    env.run();
    env.advance(2100);
    env.advance(2100);
    assert.equal(env.posts.length, 1);
    assert.deepEqual(Object.keys(JSON.parse(env.storage.nc_seen)), ['n1']);
});

test('full and both: the card shows the title and message, banner posts only for both', () => {
    const env = makeEnv({queue: [note({id: 'f', mode: 'full', title: 'Card', message: 'Only a card'}), note({id: 'b', mode: 'both', title: 'Both', message: 'Card and banner'})]});
    env.run();
    assert.equal(env.card().style.display, '', 'the card is visible');
    assert.deepEqual(env.posts.map(p => p.title), ['✅ Both'], 'only "both" also posts the native banner');
    const texts = env.cardTexts().join('|');
    assert.match(texts, /Card/);
    assert.match(texts, /Only a card/);
    assert.match(texts, /Card and banner/);
});

test('a notification that arrives while the app is open extends the stay instead of being cut short', () => {
    const env = makeEnv({queue: [note({id: 'a', duration: 5})]});
    env.run();
    env.advance(3000);
    env.queue.push(note({id: 'b', duration: 8, message: 'second'}));
    env.advance(2100);   // the first one's own 5 s would have ended here
    assert.equal(env.exits, 0, 'still open because of the second notification');
    assert.equal(env.posts.length, 2);
    env.advance(9000);
    assert.equal(env.exits, 1);
});

test('text from the network is only ever set as text, never parsed as HTML', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const env = makeEnv({queue: [note({mode: 'full', title: evil, message: evil, icon: evil})]});
    env.run();
    assert.ok(env.cardTexts().join('|').includes(evil), 'shown literally');
    assert.ok(!env.innerHTMLs.some(h => h.includes('onerror')), 'never put into innerHTML');
});

test('the picture and wallpaper addresses are built from the id on the Shard, encoded', () => {
    const env = makeEnv({queue: [note({id: 'x y/1', mode: 'full', image: 'http://pics.test/a.png', wallpaper: 'http://pics.test/w.png'})]});
    env.run();
    const all = [];
    (function walk(n) { n.children.forEach(c => { if (c.tagName === 'IMG') all.push(c.src); walk(c); }); })(env.body);
    all.push.apply(all, env.images.map(i => i._src));
    assert.ok(all.some(s => /\/plugins\/notification-center\/api\/img\?id=x%20y%2F1$/.test(s)), 'image: ' + all.join(' '));
    assert.ok(all.some(s => /img\?kind=wallpaper&id=x%20y%2F1$/.test(s)), 'wallpaper');
    assert.ok(!all.some(s => /pics\.test/.test(s)), 'the app never loads the sender URL directly');
});

test('when XHR is blocked it falls back to the script form, and it also tries the address it was loaded from', () => {
    const env = makeEnv({xhrFails: true, scriptSrc: 'http://192.168.1.50:8099/plugins/notification-center/api/nt.js?t=2', queue: [note()]});
    env.run();
    assert.ok(env.requests.some(u => u.startsWith('http://127.0.0.1:8099')), 'tries loopback first');
    assert.ok(env.scripts.length >= 1);
    const s = env.scripts[0];
    assert.match(s.src, /\?js=1&src=app&t=\d+$/);
    env.ctx.__ncNotes({lang: 'en', notifications: [note({id: 'via-script', title: 'Script path'})]});
    assert.equal(env.posts.length, 1);
    assert.equal(env.posts[0].title, '✅ Script path');
});

test('an unreachable Shard is logged and the app keeps trying', () => {
    const env = makeEnv({xhrFails: true});
    env.run();
    env.scripts.forEach(s => s.onerror && s.onerror());
    env.advance(6000);
    assert.ok(env.logLines().some(l => /Shard unreachable/.test(l)), env.logLines().join(' | '));
    assert.equal(env.exits, 0);
    assert.equal(env.posts.length, 0);
});

test('the Return and Escape keys leave the app', () => {
    const env = makeEnv({queue: []});
    env.run();
    env.fire('keydown', {keyCode: 10009});
    env.advance(700);
    assert.equal(env.exits, 1);
    const env2 = makeEnv({queue: []});
    env2.run();
    env2.fire('keydown', {keyCode: 27});
    env2.advance(700);
    assert.equal(env2.exits, 1);
});

test('the language of the screen follows the Shard setting (English by default, Portuguese on request)', () => {
    const env = makeEnv({queue: []});
    env.lang = 'pt';
    env.run();
    assert.match(env.card().getElementsByTagName('h1')[0].textContent, /Centro de Notifica/);
});

test('the overlay look is applied from the answer of the Shard, and the solid look removes it again', () => {
    const env = makeEnv({queue: [note({mode: 'full', title: 'Big', message: 'Card'})]});
    env.style = 'overlay';
    const original = env.ctx.XMLHttpRequest;
    env.ctx.XMLHttpRequest = function () {
        const x = new original();
        const send = x.send;
        x.send = () => { x.status = 200; x.responseText = JSON.stringify({lang: 'en', style: env.style, notifications: env.queue}); env.requests.push(x.url); x.onload(); };
        return x;
    };
    env.run();
    assert.equal(env.body.className, 'ov', 'overlay look');
    env.style = 'solid';
    env.queue.push(note({id: 'n2', mode: 'full', title: 'Next'}));
    env.advance(2100);
    assert.equal(env.body.className, '', 'back to the solid look');
});

test('nt.js carries the overlay rules: translucent card, no opaque background, bigger text', () => {
    assert.match(source, /body\.ov\{background:transparent\}/);
    assert.match(source, /body\.ov #nc \.card\{background:rgba\(12,16,28,\.62\)/);
    assert.match(source, /body\.ov #nc \.t\{font-size:68px\}/);
});
