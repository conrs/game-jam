/*! betacade.js 1.0.0 | https://betacade.com/llms.txt | the same window.wt on Betacade and anywhere else */
// The Betacade library. A game ships this file in its build (it never loads it from us) and calls
// Betacade.init({game, build}) before its own code, or uses the tag form:
//   <script src="betacade.js" data-game="<slug>" data-build="<number>"></script>
//
// On Betacade (our injected script got there first) it only fills in window.wt; the play page
// does the rest. Anywhere else (itch.io, the game's own site) it gives the game the same window.wt,
// every call safe, and sends play data straight to the API through the public play routes:
// sessions, heartbeats while visible, uncaught errors with the last console lines, and the
// localStorage keys named in `saves` (never all of them: itch.io serves every game from one
// origin). A corner note tells the player and offers "Don't share"; Global Privacy Control or
// Do Not Track sends nothing, as does a copy on localhost or file: (unless dev: true).
//
// Never breaks the game: everything is in try/catch, nothing touches clocks or timers, and when
// the API can't be reached it goes quiet. Plain ES5 so old engines' pages run it.
(function (root, factory) {
  var B = factory(root);
  if (typeof module === "object" && module && module.exports) module.exports = B;
  if (root) root.Betacade = B;
  try {
    var s = root && root.document && root.document.currentScript;
    if (s && s.getAttribute("data-game")) {
      B.init({
        game: s.getAttribute("data-game"),
        build: Number(s.getAttribute("data-build")),
        via: s.getAttribute("data-via") || undefined,
        saves: (s.getAttribute("data-saves") || "").split(",").filter(function (x) { return x; }),
        api: s.getAttribute("data-api") || undefined,
        dev: s.getAttribute("data-dev") === "true",
      });
    }
  } catch (e) {}
})(typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : this, function (W) {
  "use strict";
  var VERSION = "1.0.0",
    API = "https://api.betacade.com",
    PRIVACY = "https://betacade.com/privacy.html",
    SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/,
    has = Object.prototype.hasOwnProperty,
    wt = null;

  function noop() {}
  function unsub() { return noop; }
  function con(k, m) { try { var c = W.console; if (c && typeof c[k] === "function") c[k]("[Betacade] " + m); } catch (e) {} }

  // Every call the platform has, so a game can call wt.x() without ?. anywhere.
  function fill(o) {
    var d = {
      track: noop, achieve: noop, ready: noop,
      onAchievement: unsub, onPause: unsub, onResume: unsub, onSnapshot: unsub, onReplay: unsub,
      achievements: function () { return typeof Promise === "function" ? Promise.resolve([]) : null; },
    };
    for (var k in d) if (has.call(d, k) && typeof o[k] !== "function") o[k] = d[k];
    if (typeof o.replaying !== "boolean") o.replaying = false;
    if (o.replayMode === undefined) o.replayMode = null;
    if (!("paused" in o)) o.paused = false;
    if (typeof o.save !== "function") {
      // No saves in a replay: the replay shows a save, it mustn't change it.
      o.save = function (key, value) {
        if (o.replaying === true) return false;
        try { W.localStorage.setItem(String(key), JSON.stringify(value)); return true; } catch (e) { return false; }
      };
    }
    if (typeof o.load !== "function") {
      o.load = function (key, defaults) {
        var v = null;
        try { var raw = W.localStorage.getItem(String(key)); if (raw !== null) v = JSON.parse(raw); } catch (e) { v = null; }
        if (defaults && typeof defaults === "object" && !Array.isArray(defaults)) {
          var out = {}, k;
          for (k in defaults) if (has.call(defaults, k)) out[k] = defaults[k];
          if (v && typeof v === "object" && !Array.isArray(v)) for (k in v) if (has.call(v, k)) out[k] = v[k];
          return out;
        }
        return v === null ? (defaults === undefined ? null : defaults) : v;
      };
    }
    o.sdk = VERSION;
    o.host = W.__wtInjected ? "betacade" : "other";
    return o;
  }

  function init(opts) {
    if (wt) return wt;
    var o = W.wt && typeof W.wt === "object" ? W.wt : {};
    try { W.wt = o; } catch (e) {}
    wt = fill(o);
    if (!W.__wtInjected) {
      try { telemetry(opts || {}); } catch (e) {}
    }
    return wt;
  }

  function telemetry(opts) {
    var slug = typeof opts.game === "string" && SLUG.test(opts.game) ? opts.game : null;
    var build = Number(opts.build);
    if (!slug || !(build >= 1 && build % 1 === 0)) {
      con("info", "play data is sent only with Betacade.init({game: \"<slug>\", build: <number>})");
      return;
    }
    var loc = W.location || {}, nav = W.navigator || {};
    if (opts.dev !== true && (loc.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(loc.hostname || ""))) {
      con("info", "play data isn't sent from a local copy (Betacade.init({..., dev: true}) to test it)");
      return;
    }
    if (nav.globalPrivacyControl === true || nav.doNotTrack === "1" || W.doNotTrack === "1") return;
    if (typeof W.fetch !== "function") return;
    var api = typeof opts.api === "string" && /^https?:\/\/[^\s\/?#]+\/*$/.test(opts.api) ? opts.api.replace(/\/+$/, "") : API;
    var via = typeof opts.via === "string" && /^[a-z2-7]{8}$/.test(opts.via) ? opts.via : null;
    var pats = Array.isArray(opts.saves) ? opts.saves.filter(function (p) { return typeof p === "string" && p !== "" && p !== "*"; }) : [];

    var LS = null;
    try { LS = W.localStorage; } catch (e) {}
    var PK = "secret:betacade:" + slug + ":";
    function get(k) { try { return LS ? LS.getItem(PK + k) : null; } catch (e) { return null; } }
    function put(k, v) { try { if (LS) LS.setItem(PK + k, v); } catch (e) {} }
    if (get("share") === "off") return;

    var key = get("player");
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
      key = rid(24);
      put("player", key);
    }

    var S = null, opening = false, tries = 0, stopped = false, HB = null;
    var L = [], pend = [], errorsOff = false;
    var Q = [], SNAP = true, ST = null, LAST = 0, savesOff = pats.length === 0;

    function rid(n) {
      var b = new Uint8Array(n), s = "", A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      try { W.crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256); }
      for (var j = 0; j < n; j++) s += A.charAt(b[j] & 63);
      return s;
    }
    // text/plain keeps every call a simple request: no CORS preflight, and keepalive works at pagehide.
    function call(path, body, keep) {
      var s = JSON.stringify(body);
      return W.fetch(api + "/v1/play/" + path, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=UTF-8" },
        body: s,
        credentials: "omit",
        keepalive: !!keep && s.length < 60000,
      });
    }

    // Console lines and errors, as the injected script keeps them on Betacade.
    function fmt(a) {
      try {
        if (typeof a === "string") return a;
        if (a instanceof Error) return a.stack || String(a);
        var s = JSON.stringify(a);
        return s === undefined ? String(a) : s;
      } catch (e) { return String(a); }
    }
    function clean(s, n) { s = String(s).replace(/\u0000/g, ""); return s.length > n ? s.slice(0, n) : s; }
    ["log", "info", "warn", "error", "debug"].forEach(function (k) {
      var c = W.console, o = c && c[k];
      if (typeof o !== "function") return;
      c[k] = function () {
        try { L.push(clean(k + ": " + Array.prototype.map.call(arguments, fmt).join(" "), 500)); if (L.length > 200) L.shift(); } catch (e) {}
        return o.apply(this, arguments);
      };
    });
    function sendError(m) {
      if (stopped || errorsOff) return;
      if (!S) { if (pend.length < 10) pend.push(m); return; }
      call("sessions/" + S.sessionId + "/errors", { sessionSecret: S.sessionSecret, message: m.message, stack: m.stack, lines: m.lines })
        .then(function (r) { if (r.status === 429) errorsOff = true; })["catch"](noop);
    }
    function report(msg, stack) {
      try { flush(false); } catch (e) {}
      sendError({ message: clean(msg || "Error", 1000) || "Error", stack: stack ? clean(stack, 8000) : null, lines: L.slice() });
    }
    W.addEventListener("error", function (e) { try { report(e.message, e.error && e.error.stack); } catch (x) {} });
    W.addEventListener("unhandledrejection", function (e) {
      try { var r = e.reason; report("Unhandled rejection: " + (r && r.message ? r.message : fmt(r)), r && r.stack); } catch (x) {}
    });

    // Saves: only the keys the game named (exact, or a prefix ending in *), never "secret:" ones.
    var KMAX = 512, VMAX = 262144, SMAX = 1048576;
    function mine(k) {
      if (typeof k !== "string" || k === "" || k.length > KMAX || k.indexOf("secret:") === 0) return false;
      for (var i = 0; i < pats.length; i++) {
        var p = pats[i];
        if (p.charAt(p.length - 1) === "*" ? k.indexOf(p.slice(0, -1)) === 0 : k === p) return true;
      }
      return false;
    }
    function nul(s) { return s.indexOf("\u0000") < 0 ? s : s.replace(/\u0000/g, "�"); }
    function entry(k, v) {
      k = nul(k);
      if (v === null) return { key: k, value: null };
      if (v.length > VMAX) return { key: k, value: null, tooLarge: true };
      return { key: k, value: nul(v) };
    }
    function snapshot() {
      var e = [], n = 0, all = true;
      try {
        for (var i = 0; i < LS.length; i++) {
          var k = LS.key(i);
          if (k === null || !mine(k)) continue;
          if (e.length >= 2000) { all = false; break; }
          var v = LS.getItem(k);
          if (v === null) continue;
          var x = entry(k, v);
          if (!x.tooLarge) { if (n + k.length + v.length > SMAX) { all = false; continue; } n += k.length + v.length; }
          e.push(x);
        }
      } catch (err) { all = false; }
      return { complete: all, entries: e };
    }
    function rec(k, v) {
      if (savesOff || !mine(k)) return;
      var c = entry(k, v);
      c.at = Date.now();
      for (var i = 0; i < Q.length; i++) if (Q[i].key === c.key) { Q.splice(i, 1); break; }
      Q.push(c);
      if (Q.length > 500) Q.shift();
      sched();
    }
    // The API takes a sync at most every 20 s: 2 s after the last write, at least 21 s apart.
    function sched(ms) {
      if (ST !== null || !S || savesOff) return;
      var t = Date.now(), due = ms !== undefined ? t + ms : Math.max(t + 2000, LAST + 21000);
      ST = setTimeout(function () { ST = null; try { flush(false); } catch (e) {} }, Math.max(0, due - t));
    }
    function flush(keep) {
      if (ST !== null) { clearTimeout(ST); ST = null; }
      if (!S || savesOff || stopped || (!Q.length && !SNAP)) return;
      var sent = Q.splice(0, Q.length), body = { sessionSecret: S.sessionSecret, sentAt: Date.now(), changes: sent };
      if (SNAP) { body.snapshot = snapshot(); SNAP = false; }
      LAST = Date.now();
      call("sessions/" + S.sessionId + "/saves", body, keep).then(function (r) {
        if (r.status === 429) {
          return r.json().then(function (x) {
            if (x && x.error && x.error.code === "save_budget_exhausted") { savesOff = true; return; }
            Q = sent.concat(Q);
            if (body.snapshot) SNAP = true;
            var ra = Number(r.headers.get("retry-after"));
            sched(ra > 0 ? ra * 1000 : 21000);
          });
        }
        if (r.status === 404 || r.status === 409 || r.status === 400) savesOff = true;
        else if (r.status >= 500) { Q = sent.concat(Q); if (body.snapshot) SNAP = true; sched(30000); }
      })["catch"](function () { Q = sent.concat(Q); if (body.snapshot) SNAP = true; });
    }
    if (!savesOff && LS && W.Storage && W.Storage.prototype) {
      var SP = W.Storage.prototype, oSet = SP.setItem, oRem = SP.removeItem, oClr = SP.clear;
      if (typeof oSet === "function" && typeof oRem === "function" && typeof oClr === "function") {
        SP.setItem = function (k, v) { var r = oSet.apply(this, arguments); try { if (this === LS) rec(String(k), String(v)); } catch (e) {} return r; };
        SP.removeItem = function (k) { var r = oRem.apply(this, arguments); try { if (this === LS) rec(String(k), null); } catch (e) {} return r; };
        SP.clear = function () {
          var ks = [];
          try { if (this === LS) for (var i = 0; i < LS.length; i++) ks.push(LS.key(i)); } catch (e) {}
          var r = oClr.apply(this, arguments);
          try { for (var j = 0; j < ks.length; j++) if (ks[j] !== null) rec(ks[j], null); } catch (e) {}
          return r;
        };
      }
    }
    if (savesOff) con("info", "saves aren't sent: name the keys with Betacade.init({..., saves: [\"save\"]})");

    // The session.
    function disp() {
      try {
        var w = Math.round(W.innerWidth), h = Math.round(W.innerHeight), sc = W.screen || {};
        if (!(w >= 1 && h >= 1)) return undefined;
        var c = function (n) { n = Math.round(Number(n)); return n >= 1 ? Math.min(10000, n) : 1; };
        return {
          viewportW: c(w), viewportH: c(h), screenW: c(sc.width || w), screenH: c(sc.height || h),
          dpr: Math.min(8, Math.max(0.5, Number(W.devicePixelRatio) || 1)),
          orientation: w >= h ? "landscape" : "portrait",
          touch: (nav.maxTouchPoints || 0) > 0,
        };
      } catch (e) { return undefined; }
    }
    function open() {
      if (S || opening || stopped) return;
      opening = true;
      var body = { slug: slug, buildNumber: build, playerKey: key, display: disp() };
      if (via) body.via = via;
      call("sessions", body).then(function (r) {
        if (r.status === 404) con("warn", "no ready build " + build + " of \"" + slug + "\" on Betacade: play data isn't sent");
        if (r.status >= 500 || r.status === 429) throw new Error("retry");
        return r.status === 201 ? r.json() : null;
      }).then(function (s) {
        opening = false;
        if (!s || typeof s.sessionId !== "string") return;
        if (stopped) { call("sessions/" + s.sessionId + "/end", { sessionSecret: s.sessionSecret }, true)["catch"](noop); return; }
        S = s; tries = 0;
        HB = setInterval(beat, Math.max(10, Number(s.heartbeatSeconds) || 30) * 1000);
        pend.splice(0, pend.length).forEach(sendError);
        SNAP = true;
        sched(2000);
      })["catch"](function () {
        opening = false;
        if (tries < 3) setTimeout(open, 15000 * Math.pow(2, tries++));
      });
    }
    function beat() {
      if (!S || stopped || (W.document && W.document.visibilityState !== "visible")) return;
      call("sessions/" + S.sessionId + "/heartbeat", { sessionSecret: S.sessionSecret })
        .then(function (r) { if (r.status === 404 || r.status === 409) drop(); })["catch"](noop);
    }
    function drop() { if (HB !== null) clearInterval(HB); HB = null; S = null; }
    function end() {
      if (!S) return;
      try { flush(true); } catch (e) {}
      var s = S;
      drop();
      call("sessions/" + s.sessionId + "/end", { sessionSecret: s.sessionSecret, lines: L.slice() }, true)["catch"](noop);
    }
    function stop() { stopped = true; end(); }

    W.addEventListener("pagehide", end);
    W.addEventListener("pageshow", function (e) { if (e.persisted && !stopped) { SNAP = true; open(); } });
    if (W.document) {
      W.document.addEventListener("visibilitychange", function () {
        try { if (W.document.visibilityState === "hidden") flush(true); } catch (e) {}
      });
    }

    // The corner note: shown until the player answers; "Don't share" ends the session for good.
    function note() {
      var d = W.document;
      if (!d || get("share") === "on") return;
      function show() {
        try {
          var h = d.createElement("div"), r = h.attachShadow ? h.attachShadow({ mode: "closed" }) : h;
          h.setAttribute("style", "position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:calc(100vw - 16px)");
          var b = "font:inherit;margin-left:6px;padding:3px 9px;border-radius:5px;border:1px solid #888;cursor:pointer;";
          r.innerHTML =
            '<div style="font:12px/1.4 system-ui,-apple-system,sans-serif;color:#eee;background:rgba(18,18,26,.92);padding:7px 10px;border-radius:8px;max-width:420px;box-shadow:0 4px 16px rgba(0,0,0,.4)">' +
            "This game sends anonymous play data (play time, errors, progress) to its developer through Betacade. " +
            '<a href="' + PRIVACY + '" target="_blank" rel="noopener" style="color:#9cf">Privacy</a>' +
            '<span style="white-space:nowrap"><button data-a="ok" style="' + b + 'background:#eee;color:#111">OK</button>' +
            '<button data-a="no" style="' + b + 'background:transparent;color:#eee">Don\'t share</button></span></div>';
          // The game never sees a click meant for the note.
          ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click", "keydown", "keyup"].forEach(function (n) {
            h.addEventListener(n, function (e) { e.stopPropagation(); });
          });
          var gone = false;
          function hide() { if (gone) return; gone = true; try { h.remove(); } catch (e) {} }
          var bs = r.querySelectorAll("button");
          for (var i = 0; i < bs.length; i++) {
            bs[i].addEventListener("click", function (e) {
              var a = e.currentTarget.getAttribute("data-a");
              if (a === "no") { put("share", "off"); stop(); } else put("share", "on");
              hide();
            });
          }
          (d.body || d.documentElement).appendChild(h);
          setTimeout(hide, 20000);
        } catch (e) {}
      }
      if (d.body) show();
      else d.addEventListener("DOMContentLoaded", show);
    }

    note();
    open();
  }

  return { version: VERSION, init: init };
});
