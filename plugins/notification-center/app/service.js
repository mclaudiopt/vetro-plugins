// Background service of the Notification Center companion app (Node.js in the TV's web service runtime).
// Vetro starts it (POST /apps/launch) each time a notification is queued in "banner" mode; it posts the native Samsung banner with
// webapis.postPlainNotification, without opening any app.
// It reads the queue from a file the Shard writes (no network, no Vetro key: it works with pairing on). If that file is missing it asks the
// Shard over the network, on the TV's own LAN address (loopback is not reachable from the service on every TV).
// The ids it has already shown are kept in a file of its own, so a restarted service never shows the same banner twice.
var QUEUE_FILE = '/tmp/notification-center-queue.json';
var SEEN_FILE = '/tmp/notification-center-seen.json';
var HOSTS = ['127.0.0.1'];
try {
  var ifs = require('os').networkInterfaces();
  Object.keys(ifs).forEach(function (k) { ifs[k].forEach(function (i) { if (i.family === 'IPv4' && !i.internal && HOSTS.indexOf(i.address) < 0) { HOSTS.push(i.address); } }); });
} catch (e) { /* keep loopback only */ }
var PATH = '/plugins/notification-center/api/notifications';
var EMOJI = { info: '\u2139\uFE0F', ok: '\u2705', warn: '\u26A0\uFE0F', alert: '\uD83D\uDD34' };
// Diagnosis: the service says what happened (it started, where it read the queue, whether the banner function exists and what it threw) to the Shard,
// over the network and in a file. The Shard shows the last reports in GET status. Nothing from a notification except its id is reported.
var REPORT_FILE = '/tmp/notification-center-report.json';
var REPORT_PATH = '/plugins/notification-center/api/service-report';
var reports = [];
function errText(e) { return String(e && e.message ? (e.name || 'Error') + ': ' + e.message : (e && e.name) || e).slice(0, 200); }
function post(host, body, fail) {
  var failed = false;
  function once() { if (!failed) { failed = true; fail(); } }
  try {
    var rq = require('http').request({ host: host, port: 8099, method: 'POST', path: REPORT_PATH, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, function (r) {
      r.resume();
      if (r.statusCode !== 200) { once(); }
    });
    rq.on('error', once);
    rq.setTimeout(4000, function () { rq.abort(); once(); });
    rq.end(body);
  } catch (e) { once(); }
}
function report(stage, data) {
  try {
    var r = data || {}, i = 0;
    r.stage = stage;
    r.node = typeof process === 'object' && process ? String(process.version) : 'unknown';
    r.fetch = typeof fetch;
    r.webapis = typeof webapis;
    r.postFunction = typeof webapis === 'object' && webapis ? typeof webapis.postPlainNotification : 'undefined';
    reports.push(r);
    if (reports.length > 6) { reports.shift(); }
    try { require('fs').writeFileSync(REPORT_FILE, JSON.stringify({ at: Date.now(), reports: reports })); } catch (e) { /* not writable: the network copy remains */ }
    var body = JSON.stringify(r);
    (function next() { if (i < HOSTS.length) { post(HOSTS[i++], body, next); } })();
  } catch (e) { /* the diagnosis must never stop a banner */ }
}
var seen = {};
try { seen = JSON.parse(require('fs').readFileSync(SEEN_FILE, 'utf8')) || {}; } catch (e) { seen = {}; }

function saveSeen() {
  try {
    var keys = Object.keys(seen);
    if (keys.length > 60) { keys.slice(0, keys.length - 60).forEach(function (k) { delete seen[k]; }); }
    require('fs').writeFileSync(SEEN_FILE, JSON.stringify(seen));
  } catch (e) { /* not writable: duplicates are possible only if the service restarts while a notification is still queued */ }
}
function show(n) {
  // The native banner takes plain text only, but it draws emoji: the icon (or the level's emoji) goes in front of the title.
  var head = n.icon || EMOJI[n.level] || '';
  var title = (head ? head + ' ' : '') + (n.title || 'Notification');
  try {
    var ret = webapis.postPlainNotification(title, n.message || '', parseInt(n.duration, 10) || 8);
    report('posted', { id: String(n.id), returned: String(ret).slice(0, 80) });
  } catch (e) { report('post-failed', { id: String(n.id), error: errText(e) }); }
}
function handle(list) {
  var changed = false;
  list.forEach(function (n) {
    if (seen[n.id]) { return; }
    seen[n.id] = 1; changed = true;
    if (n.mode !== 'banner') { return; }                          // "full" and "both" are shown by the companion app screen
    if (n.expires && n.expires < Date.now()) { return; }          // too old to be worth showing
    show(n);
  });
  if (changed) { saveSeen(); }
}
function queueRead(source, list, fileError) {
  report('queue', { source: source, count: list.length, fresh: list.filter(function (n) { return !seen[n.id]; }).length, fileError: fileError });
  handle(list);
}
function fromNetwork(fileError) {
  var i = 0, errors = [];
  (function next() {
    if (i >= HOSTS.length) { report('queue-failed', { fileError: fileError, netError: errors.join(' | ').slice(0, 200) }); return; }
    getJson(HOSTS[i++], PATH + '?t=' + Date.now(), function (e, d) {
      if (e) { errors.push(errText(e)); next(); return; }
      queueRead('network', d.notifications || [], fileError);
    });
  })();
}
// fetch where the TV's runtime has it, otherwise Node's http (Node 12 on some monitors has no fetch). Calls done once.
function getJson(host, path, done) {
  var finished = false;
  function end(e, d) { if (!finished) { finished = true; done(e, d); } }
  if (typeof fetch === 'function') {
    fetch('http://' + host + ':8099' + path).then(function (r) { if (!r.ok) { throw new Error('http ' + r.status); } return r.json(); }).then(function (d) { end(null, d); }, end);
    return;
  }
  try {
    var rq = require('http').get({ host: host, port: 8099, path: path }, function (r) {
      var text = '';
      r.setEncoding('utf8');
      r.on('data', function (c) { text += c; if (text.length > 200000) { end(new Error('answer too large')); rq.abort(); } });
      r.on('end', function () {
        var d;
        if (r.statusCode !== 200) { end(new Error('http ' + r.statusCode)); return; }
        try { d = JSON.parse(text); } catch (e) { end(e); return; }
        end(null, d || {});
      });
    });
    rq.on('error', end);
    rq.setTimeout(4000, function () { end(new Error('timeout')); rq.abort(); });
  } catch (e) { end(e); }
}
function check() {
  var d = null, fileError = '';
  try { d = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf8')); } catch (e) { d = null; fileError = errText(e); }
  if (d && Array.isArray(d.notifications)) { queueRead('file', d.notifications, ''); } else { fromNetwork(fileError || 'no notifications list in the file'); }
}
module.exports.onStart = function () { report('start'); check(); };
module.exports.onRequest = check;
module.exports.onStop = function () {};
