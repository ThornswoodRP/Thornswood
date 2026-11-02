// scripts/bot/bot.js
//
// #5196. A scripted bot that connects to a Thornswood server the way the
// game does, logs in as a character and reads what the server sends it.
// Nothing here starts Skyrim: the connection is the engine's own, through
// createBotClient in the server's scam_native.node (the fork's
// mp_common/BotClient), so every byte a bot sends or reads is the one a game
// would. The server folder already holds that addon, so a bot needs nothing
// installed beside the server it checks.
//
// The login is the game's (skymp5-client's authService):
//   1. connect with the protocol version and the server's password;
//   2. customPacket loginWithSkympIo { gameData: { profileId } };
//   3. the server's thornswoodLoginChallenge { n }, answered with
//      thornswoodLoginProof { pass, mac } when the bot holds a join pass
//      (mac is HMAC-SHA256 of "jlp1." + n under the pass's own key, the
//      site's passLoginKey);
//   4. createActor with isMe: the character, as its owner's game gets it.
// A bot on a server of its own signs its passes with that server's passKey
// (mintPass below, the site's makePass), so no key of a real server is used.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MSG = { CustomPacket: 1, UpdateMovement: 2, UpdateProperty: 7, DestroyActor: 25, SetInventory: 28, SetRaceMenuOpen: 29, CreateActor: 33 };

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The site's makePass (site/server.js): the profile, server, launcher
// version, Discord id, issue time and expiry, signed with the server's passKey.
function mintPass(passKey, o) {
  const body = b64u(JSON.stringify({ p: o.p, s: o.s, v: o.v, d: o.d, i: o.i, x: o.x }));
  const mac = b64u(crypto.createHmac('sha256', passKey).update('jp1.' + body).digest());
  return 'jp1.' + body + '.' + mac;
}

// The site's passLoginKey: the key the login proof is made with.
function passLoginKey(passKey, pass) {
  const mac = String(pass || '').split('.')[2] || '';
  return b64u(crypto.createHmac('sha256', passKey).update('jpk1.' + mac).digest());
}

// skymp5-client's thornswoodLoginMac.
function loginMac(loginKey, nonce) {
  return b64u(crypto.createHmac('sha256', loginKey).update('jlp1.' + String(nonce)).digest());
}

// The addon of the server folder root. Its engine must have createBotClient
// (the fork's #137); an older one is named, not worked around.
function loadAddon(root) {
  const file = path.join(root, 'scam_native.node');
  if (!fs.existsSync(file)) {
    throw new Error('there is no scam_native.node in ' + root + ', so this is not a server folder');
  }
  const addon = require(file);
  if (typeof addon.createBotClient !== 'function') {
    throw new Error('the engine in ' + root + ' has no createBotClient: it is older than the bot client ' +
                    '(skymp fork #137), so its pin has to move before a bot can connect');
  }
  return addon;
}

class Bot {
  // opts: { host, port, password, timeoutMs, name, log }
  constructor(addon, opts) {
    this.addon = addon;
    this.host = opts.host || '127.0.0.1';
    this.port = Number(opts.port);
    this.password = String(opts.password || '');
    this.timeoutMs = Number(opts.timeoutMs) || 60000;
    this.name = opts.name || 'bot';
    this.log = opts.log || (() => {});
    this.client = null;
    this.state = 'new';      // new, connecting, connected, refused, closed
    this.refusal = '';
    this.inbox = [];         // every message read, in order: { at, message } or { at, raw }
    this.custom = [];        // custom packets, parsed: { at, content }
    this.character = null;   // the createActor with isMe
    this.pass = null;        // { pass, loginKey } once the bot holds one
    this.challenge = null;   // the nonce of this connection's login
    this.answered = false;
  }

  // Reads everything the connection has, once.
  pump() {
    if (!this.client) { return; }
    const events = this.client.tick();
    const now = Date.now();
    for (const e of events) {
      if (e.type === 'connectionAccepted') { this.state = 'connected'; this.log(this.name + ' connected'); continue; }
      if (e.type === 'connectionDenied' || e.type === 'connectionFailed') {
        this.state = 'refused'; this.refusal = e.type + (e.error ? ': ' + e.error : '');
        this.log(this.name + ' ' + this.refusal); continue;
      }
      if (e.type === 'disconnect') { this.state = 'closed'; this.log(this.name + ' disconnected'); continue; }
      if (e.type !== 'message') { continue; }
      let m = e.message;
      if (!m && typeof e.raw === 'string') {
        try { m = JSON.parse(e.raw); } catch (err) { m = null; }
      }
      if (!m) { this.inbox.push({ at: now, raw: e.raw }); continue; }
      this.inbox.push({ at: now, message: m });
      if (m.t === MSG.CreateActor && m.isMe && !this.character) {
        this.character = m;
        this.log(this.name + ' was sent its character, idx ' + m.idx);
      }
      if (m.t === MSG.CustomPacket && typeof m.contentJsonDump === 'string') {
        let c = null;
        try { c = JSON.parse(m.contentJsonDump); } catch (err) { c = null; }
        if (c) { this.custom.push({ at: now, content: c }); this.onCustom(c); }
      }
    }
  }

  onCustom(c) {
    if (c.customPacketType === 'thornswoodLoginChallenge' && typeof c.n === 'string') {
      this.challenge = c.n;
      this.answer();
    }
  }

  // The login proof, once, when there is both a challenge and a pass.
  answer() {
    if (this.answered || !this.challenge || !this.pass) { return; }
    this.answered = true;
    this.sendCustom({ customPacketType: 'thornswoodLoginProof', pass: this.pass.pass,
                      mac: loginMac(this.pass.loginKey, this.challenge) });
    this.log(this.name + ' answered the login challenge');
  }

  send(message, reliable) {
    if (!this.client) { throw new Error(this.name + ' is not connected'); }
    this.client.send(message, reliable !== false);
  }

  sendCustom(content) {
    this.send({ t: MSG.CustomPacket, contentJsonDump: JSON.stringify(content) }, true);
  }

  // Ticks until test() returns something truthy, which it returns, or until
  // ms have passed, which throws with what was awaited. The server answers
  // over the network, so this is how long the check gives it; nothing is
  // sent again.
  async until(test, ms, what) {
    const end = Date.now() + ms;
    for (;;) {
      this.pump();
      const v = test();
      if (v) { return v; }
      if (this.state === 'refused') { throw new Error(this.name + ' was refused (' + this.refusal + ') while waiting for ' + what); }
      if (Date.now() >= end) { throw new Error(this.name + ' had no ' + what + ' in ' + Math.round(ms / 1000) + ' s'); }
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async connect(ms) {
    this.client = this.addon.createBotClient(this.host, this.port, this.password, this.timeoutMs);
    this.state = 'connecting';
    await this.until(() => this.state === 'connected', ms || 15000, 'connection to ' + this.host + ':' + this.port);
  }

  // Logs in as profileId and waits for the character. pass, when given, is
  // { pass, loginKey } and answers the login challenge.
  async login(profileId, pass, ms) {
    if (pass) { this.pass = pass; }
    this.sendCustom({ customPacketType: 'loginWithSkympIo', gameData: { profileId: Number(profileId) } });
    this.log(this.name + ' logged in as profile ' + profileId);
    return this.until(() => this.character, ms || 30000, 'character from the server');
  }

  close() {
    if (this.client) { this.client.destroy(); this.client = null; }
    this.state = 'closed';
  }
}

module.exports = { Bot, MSG, mintPass, passLoginKey, loginMac, loadAddon, b64u };
