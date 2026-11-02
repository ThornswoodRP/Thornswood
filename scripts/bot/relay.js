// scripts/bot/relay.js
//
// #5196. The bot's way into the voice service, the relay most of the world
// goes over. The game's chat page holds a WebSocket to the voice service, and
// every slash line it sends (a button's command, the launcher's join pass,
// a pick on the K panel) is queued there for the gamemode, which collects
// them over loopback (GET /commands) and answers through the service again
// (POST /say), as well as over the game connection. So stations, claims and
// keys, needs, merchants and the jail are all reached this way, and a bot
// that has only the game connection (bot.js) can reach none of them.
//
// The way in is the game's:
//   1. a join token from the service's own /token, asked with a ticket, which
//      the service checks with the site (/api/play/owns) before it mints one;
//   2. the WebSocket handshake offering 'thornswood' and that token, which
//      opens this one connection and no other;
//   3. { t: 'join' }, answered { t: 'welcome' }; then { t: 'chat', text }.
// A bot pass runs a voice service of its own beside its server copy
// (VoiceRun below), from the same Release as the gamemode, and stands in for
// the site with a site of its own on loopback that owns its profiles for its
// one ticket and nobody else's. No key of a real service or site is used, and
// nothing listens anywhere but loopback.
'use strict';
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

// What the voice service is: the files a Release's voice part and its bot
// part both carry (App-Part.ps1, merge-release.yml).
const VOICE_FILES = ['voice-server.js', 'headlines.js'];

function post(port, route, body, ms) {
  return new Promise((ok, bad) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: route, method: 'POST', agent: false, timeout: ms,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), connection: 'close' }
    }, (res) => {
      let text = '';
      res.on('data', (d) => { if (text.length < 65536) { text += d; } });
      res.on('end', () => ok({ status: res.statusCode, text }));
    });
    req.on('timeout', () => { req.destroy(new Error('no answer from 127.0.0.1:' + port + route + ' in ' + ms + ' ms')); });
    req.on('error', bad);
    req.end(data);
  });
}

// One run of the voice service in dir, on port, with a site of its own.
class VoiceRun {
  // opts: { from, dir, port, logFile, log }. from is where the voice files
  // are (the bot's own folder, which the Release's bot part fills).
  constructor(opts) {
    this.from = opts.from;
    this.dir = opts.dir;
    this.port = Number(opts.port);
    this.logFile = opts.logFile || path.join(opts.dir, 'bot-pass-voice.log');
    this.log = opts.log || (() => {});
    this.ticket = crypto.randomBytes(24).toString('hex');
    this.site = null;
    this.sitePort = 0;
    this.child = null;
    this.exited = null;
    this.lines = [];
    this.tail = [];
    this.partial = '';
  }

  // '' when every voice file is beside the bot, else what is missing.
  missing() {
    const gone = VOICE_FILES.filter((n) => !fs.existsSync(path.join(this.from, n)));
    return gone.length ? 'there is no ' + gone.join(' or ') + ' in ' + this.from + ', so the bot part this pass came in carries no voice service' : '';
  }

  // The site's half, POST /api/play/owns: this run's ticket owns every
  // profile, any other ticket owns none, as site/server.js answers.
  startSite() {
    return new Promise((ok, bad) => {
      this.site = http.createServer((req, res) => {
        let b = '';
        req.on('data', (d) => { if (b.length < 8192) { b += d; } });
        req.on('end', () => {
          let o = {};
          try { o = JSON.parse(b); } catch (e) { o = {}; }
          if (req.method !== 'POST' || req.url !== '/api/play/owns') { res.writeHead(404).end(); return; }
          const yes = typeof o.ticket === 'string' && o.ticket === this.ticket && Number(o.profileId) > 0;
          res.writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify(yes ? { ok: true, why: 'theirs' } : { ok: false, why: 'not theirs' }));
        });
      });
      this.site.on('error', bad);
      this.site.listen(0, '127.0.0.1', () => { this.sitePort = this.site.address().port; ok(); });
    });
  }

  // Copies the service in and starts it; '' once it says it is listening on
  // its port, else why not.
  async start(ms) {
    const gone = this.missing();
    if (gone) { return gone; }
    if (!(this.port > 0)) { return 'server-settings.json names no thornswoodVoicePort for the voice service'; }
    fs.mkdirSync(this.dir, { recursive: true });
    for (const n of VOICE_FILES) { fs.copyFileSync(path.join(this.from, n), path.join(this.dir, n)); }
    await this.startSite();
    // Nothing of the box's own voice settings comes along: this service is
    // set by this run alone.
    const env = {};
    for (const k of Object.keys(process.env)) { if (!/^THORNSWOOD_/i.test(k)) { env[k] = process.env[k]; } }
    env.THORNSWOOD_VOICE_PORT = String(this.port);
    env.THORNSWOOD_VOICE_BIND = '127.0.0.1';
    env.THORNSWOOD_SITE = 'http://127.0.0.1:' + this.sitePort;
    this.child = childProcess.spawn(process.execPath, ['voice-server.js'], {
      cwd: this.dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    const take = (chunk) => {
      const parts = (this.partial + String(chunk)).split(/\r?\n/);
      this.partial = parts.pop();
      for (const l of parts) {
        this.lines.push(l);
        this.tail.push(l);
        if (this.tail.length > 30) { this.tail.shift(); }
        try { fs.appendFileSync(this.logFile, l + '\n'); } catch (e) { /* the tail still holds it */ }
      }
    };
    this.child.stdout.on('data', take);
    this.child.stderr.on('data', take);
    this.child.on('exit', (code, signal) => { this.exited = { code, signal }; });
    const said = new RegExp('\\[voice\\] listening on 127\\.0\\.0\\.1:' + this.port + '\\b');
    const end = Date.now() + ms;
    for (;;) {
      if (this.lines.some((l) => said.test(l))) { return ''; }
      if (this.exited) {
        return 'the voice service ended (' + JSON.stringify(this.exited) + ') before it was listening' +
          (this.lines.some((l) => /EADDRINUSE/.test(l)) ? ': something else holds port ' + this.port : '');
      }
      if (Date.now() > end) { return 'the voice service did not say it was listening on ' + this.port + ' within ' + Math.round(ms / 1000) + ' s'; }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // A join token for profileId, the way the launcher asks for one.
  async token(profileId, ms) {
    const r = await post(this.port, '/token', { profileId: Number(profileId), ticket: this.ticket }, ms || 10000);
    let doc = null;
    try { doc = JSON.parse(r.text); } catch (e) { doc = null; }
    if (r.status !== 200 || !doc || typeof doc.token !== 'string') {
      throw new Error('the voice service gave no join token for profile ' + profileId + ' (' + r.status + ' ' + String(r.text).trim().slice(0, 120) + ')');
    }
    return doc.token;
  }

  async stop(ms) {
    if (this.site) { this.site.close(); this.site = null; }
    if (!this.child || this.exited) { return true; }
    this.child.kill();
    const end = Date.now() + (ms || 10000);
    while (!this.exited && Date.now() < end) { await new Promise((r) => setTimeout(r, 50)); }
    return !!this.exited;
  }
}

// One bot's connection to the voice service, as the game's chat page holds it.
class Relay {
  // opts: { profileId, name, log }
  constructor(voice, opts) {
    this.voice = voice;
    this.profileId = Number(opts.profileId);
    this.name = opts.name || 'bot';
    this.log = opts.log || (() => {});
    this.ws = null;
    this.heard = [];      // every message the service sent, in order
    this.closed = '';
    this.welcome = null;
  }

  async connect(ms) {
    if (typeof WebSocket !== 'function') {
      throw new Error('this node (' + process.version + ') has no WebSocket; the relay client needs node 22 or later');
    }
    const token = await this.voice.token(this.profileId, ms);
    this.ws = new WebSocket('ws://127.0.0.1:' + this.voice.port + '/', ['thornswood', token]);
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ t: 'join', profileId: this.profileId, name: this.name, voice: false }));
    };
    this.ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
      this.heard.push(m);
      if (m.t === 'welcome' && !this.welcome) { this.welcome = m; this.log(this.name + ' is in the voice service as profile ' + m.profileId); }
    };
    this.ws.onclose = (ev) => { this.closed = 'closed (' + (ev && ev.code) + ')'; };
    this.ws.onerror = () => { if (!this.closed) { this.closed = 'refused'; } };
    await this.until(() => this.welcome, ms, 'a welcome from the voice service');
    if (Number(this.welcome.profileId) !== this.profileId) {
      throw new Error('the voice service let ' + this.name + ' in as profile ' + this.welcome.profileId + ', not ' + this.profileId);
    }
    return this.welcome;
  }

  // A line, as the chat page sends one; a slash line goes to the gamemode.
  say(text) {
    if (!this.ws || this.closed) { throw new Error(this.name + ' has no connection to the voice service'); }
    this.ws.send(JSON.stringify({ t: 'chat', text: String(text) }));
  }

  // The lines the server said to this bot alone (from 0, POST /say), after
  // index from of heard.
  said(from) {
    return this.heard.slice(from || 0).filter((m) => m.t === 'chat' && m.from === 0 && typeof m.text === 'string').map((m) => m.text);
  }

  async until(test, ms, what) {
    const end = Date.now() + ms;
    for (;;) {
      const v = test();
      if (v) { return v; }
      if (this.closed) { throw new Error(this.name + '\'s voice connection was ' + this.closed + ' while waiting for ' + what); }
      if (Date.now() >= end) { throw new Error(this.name + ' had no ' + what + ' in ' + Math.round(ms / 1000) + ' s'); }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  close() {
    if (this.ws) { try { this.ws.close(); } catch (e) { /* already gone */ } this.ws = null; }
    if (!this.closed) { this.closed = 'closed by the bot'; }
  }
}

module.exports = { VoiceRun, Relay, VOICE_FILES };
