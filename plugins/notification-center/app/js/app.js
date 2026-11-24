(function () {
  "use strict";
  // The screen app only loads nt.js from the Shard (the Shard serves the logic, so the installed app rarely needs an update).
  // The TV's web view cannot reach 127.0.0.1:8099, but it can reach the TV's own address on the network, so the app asks the TV for that address
  // (the Samsung network API, then the Tizen system info of the wired and the wireless network) and tries it first. 127.0.0.1 stays as the last try.
  var PATH = "/plugins/notification-center/api/nt.js";
  var logEl = document.getElementById("log");
  function say(t) { var d = document.createElement("div"); d.textContent = t; logEl.appendChild(d); }

  // A plain dotted IPv4 address of this TV: four numbers up to 255, not 0.0.0.0, not loopback. Anything else is ignored, so no text from the system
  // information can turn into a different address.
  function validIp(s) {
    if (typeof s !== "string" || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)) { return false; }
    var p = s.split("."), i;
    for (i = 0; i < 4; i++) { if (parseInt(p[i], 10) > 255) { return false; } }
    return s !== "0.0.0.0" && p[0] !== "127";
  }

  function findIp(done) {
    var finished = false;
    function end(ip) { if (!finished) { finished = true; done(validIp(ip) ? ip : ""); } }
    try { if (window.webapis && window.webapis.network && window.webapis.network.getIp) { var ip0 = window.webapis.network.getIp(); if (validIp(ip0)) { return end(ip0); } } } catch (e) { /* not available */ }
    var kinds = ["ETHERNET_NETWORK", "WIFI_NETWORK"], left = kinds.length, i;
    function one(v) {
      left -= 1;
      if (v && validIp(v.ipAddress)) { return end(v.ipAddress); }
      if (left <= 0) { end(""); }
    }
    try {
      for (i = 0; i < kinds.length; i++) { window.tizen.systeminfo.getPropertyValue(kinds[i], one, function () { one(null); }); }
    } catch (e) { end(""); }
    setTimeout(function () { end(""); }, 2500);   // never wait for the system information for long
  }

  function load(bases) {
    var i = 0;
    (function next() {
      if (i >= bases.length) { say("Could not load nt.js from the Shard. Is it running?"); return; }
      var s = document.createElement("script");
      s.src = bases[i++] + PATH + "?t=" + new Date().getTime();
      s.onerror = function () { say("nt.js failed: " + s.src.split("?")[0]); next(); };
      (document.head || document.documentElement).appendChild(s);
    })();
  }

  findIp(function (ip) { load(ip ? ["http://" + ip + ":8099", "http://127.0.0.1:8099"] : ["http://127.0.0.1:8099"]); });
})();
