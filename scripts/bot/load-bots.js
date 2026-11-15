// scripts/bot/load-bots.js
//
// #4623. One of the load test's bot processes. Load-Test.js starts a few of
// these (child_process.fork) so the bots' own work is spread over the
// runner's cores, and tells each one how many bots to add. Every bot is the
// engine's own client (createBotClient in the server's scam_native.node,
// bot.js), so it connects, logs in and moves the way a game does:
//   1. connect over the game's port with the server's password (through
//      load-proxy.js, which counts the bytes);
//   2. log in as a profile nobody has, with a join pass the bot signs with
//      the load copy's own pass key (bot.js mintPass, the site's makePass;
//      a Discord id of its own, so no two bots are one account), answer the
//      login challenge with it as the launcher's game does, and wait for its
//      character (createActor with isMe);
//   3. send a face (UpdateAppearance), which closes the race menu the engine
//      opens for a new character;
//   4. walk: an UpdateMovement every 130 ms, unreliable, the rate and the
//      reliability skymp5-client's SendInputsService.sendMovement uses, in a
//      slow circle around where it was put, at a walk. A teleport the server
//      sends (Teleport, Teleport2) is carried out and its teleportSeq echoed,
//      as the game's RemoteServer does. Moves keep to their 130 ms beat
//      (the next is due 130 ms after the last was due), so Windows' timer
//      steps of about 15.6 ms do not slow a bot below the game's rate.
//   5. hold the game's chat socket on the voice service, as a person in the
//      world does: a join token (POST /token, as the launcher asks for it),
//      the socket with it, a join with voice off, and over it the join pass
//      as "/joinpass <pass>" at once and every minute, a new pass each time,
//      which is what the launcher's front plugin sends (gamemode.js, THE
//      PASS). The gamemode takes the pass from the voice service's command
//      queue, and ends a session with none three minutes in. The proof at
//      the login is a different check (#1320).
// Every message the server sends is read and counted, by type; none is kept.
// What the chat socket carries is counted in bytes each way.
//
// WHAT ELSE A PERSON DOES (--play, any of fight, host, trade and quest). Each bot
// keeps where the actors it is sent are (CreateActor, their moves,
// DestroyActor), and:
//   fight  every 2 to 3 s swings at another person in its cell within
//          FIGHT_REACH: an attack animation (UpdateAnimation, attackStart)
//          and the hit (OnHit, unarmed, 0x1f4, the engine's IsUnarmedAttack),
//          both reliable, as skymp5-client sends them. What the server makes
//          of it (ChangeValues, death, respawn) shows in the message counts;
//   host   carries out HostStart: the actor it is handed (an NPC near it,
//          whose AI a game runs and the server only passes on) is sent an
//          UpdateMovement on the same 130 ms beat as its own character,
//          standing where the server put it, until HostStop. Without this the
//          bots would leave every NPC's moves out of the load;
//   trade  every 30 s asks, over the chat socket as a person types it, to
//          trade with the nearest NPC within TRADE_REACH: "/merchant <id>",
//          the guild trader command the panel's E press is (gamemode.js,
//          createMerchantTrading). The answers are counted by what they say.
//   quest  takes guild work the way the trader panel's buttons ask for it
//          (game/ui/thornswood-merchant.js): every 30 s or so it stands still
//          beside the nearest NPC within the trade block's REACH, opens the
//          panel ("/merchant <id>") and reads the view the server pushes
//          (the thornswoodMerchantView property, visible by its owner);
//          5 s later it presses Take work on the first work it can take
//          ("/merchant quest take <id>", with the commission's quote as the
//          panel sends it), 5 s after that Leave work on what it holds
//          ("/merchant quest abandon <id> @<token>"), then Step back
//          ("/merchant close") and walks on. Each take and leave is a saved
//          change on the server (the trader's purse holds the commission's
//          gold, the quest record on the character), which is the quest load.
//          A new character holds no trade, so every rank of work is locked
//          to it: on the first panel with nothing it can take, it picks the
//          trade of a novice work it saw there ("/pick profession <p>
//          <half>"), as a person picks one on the K panel, and opens the
//          panel again. Turning work in needs the work done (the goods, the
//          kill, the item fetched), which a crowd standing in one inn does
//          not do, so a bot leaves what it took. The answers are counted by
//          what they say, against the merchant block's own lines.
//
// Messages from Load-Test.js:
//   { add: [profileId, ...] }   bots to start
//   { report: true }            answered with { report: {...} }
//   { stop: true }              closes every bot and ends
'use strict';
const os = require('os');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Bot, MSG, loadAddon, mintPass, passLoginKey } = require('./bot.js');
const { face } = require('./Bot-Pass.js');

const MOVE_MS = 130;           // SendInputsService.sendMovement's sendMovementRateMs
const STEP_MS = 60000;         // how long each login step may take
const WALK = 100;              // units a second, a walk
const TELEPORT = 20;
const TELEPORT2 = 31;
const PASS_EVERY_MS = 60000;   // the front plugin sends the pass at once and every minute
const UPDATE_ANIMATION = 3;
const ON_HIT = 17;
const HOST_START = 26;
const HOST_STOP = 27;
const UNARMED = 0x1f4;         // ActionListener.cpp IsUnarmedAttack
const FIGHT_REACH = 1000;      // units: who a bot swings at
const TRADE_REACH = 600;       // units: which NPC a bot asks to trade with
const TRADE_EVERY_MS = 30000;
const PLAYER_IDS = 0xff000000; // a person's character; an NPC's refrId is its form id plus 2^32 (PartOne.cpp)
const QUEST_REACH = 400;       // merchant-trading-bundle.ts REACH: the panel answers somebody this near
const QUEST_EVERY_MS = 30000;  // from one Step back to the next panel
const QUEST_STEP_MS = 5000;    // between the presses at an open panel
const MERCHANT_VIEW = 'thornswoodMerchantView';
// What the merchant block says to a quest press (merchant-trading-bundle.ts,
// the quest verb's text and reasons), by the count it adds to. A line said
// for anything else is a trade answer.
const QUEST_SAID = {
  'You take the work.': 'questTaken',
  'You give back what you drew and leave the work.': 'questLeft',
  'You leave the work without payment.': 'questLeft',
  'The work is turned in.': 'questTurnedIn',
  'Choose the work in the trader panel.': 'questRefused:panel',
  'This work takes a different class.': 'questRefused:class',
  'This work takes a higher rank.': 'questRefused:rank',
  'You do not meet this work\'s class or profession requirements.': 'questRefused:eligibility',
  'This work is still resting.': 'questRefused:cooldown',
  'You already hold this work.': 'questRefused:open',
  'You do not hold this work.': 'questRefused:none',
  'This work has no appointed place yet.': 'questRefused:unbound',
  'The work could not be committed just now.': 'questRefused:unwritten',
  'Quest work is unavailable.': 'questRefused:unavailable',
  'This trader does not handle that work.': 'questRefused:role',
  'The submitted price changed or is missing. Choose the work again.': 'questRefused:price',
  'This trader cannot reserve the quoted payment.': 'questRefused:purse',
  'This trader cannot accept more work yet.': 'questRefused:capacity',
  'The transfer is waiting for its saved inventory.': 'questRefused:waiting',
  'Finish or leave one of your three open jobs of this kind first.': 'questRefused:open-limit',
  'Choose the work again from the trader.': 'questRefused:session',
  'The work could not be changed.': 'questRefused:other'
};

function distance(a, b) {
  const dx = a[0] - b[0]; const dy = a[1] - b[1]; const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// A bot that reads what it is sent without keeping it: Bot.pump keeps every
// message, which a load test cannot (a crowd of 60 is sent tens of
// thousands a second).
class LoadBot extends Bot {
  constructor(addon, opts) {
    super(addon, opts);
    this.counts = {};          // message type -> how many, since the last report
    this.all = 0;              // every message, since it connected
    this.step = 'new';         // new, connecting, login, face, moving, failed
    this.why = '';
    this.deadline = 0;
    this.seq = 0;              // the newest teleportSeq carried out
    this.center = null;        // [x, y, z] it walks around
    this.cell = 0;
    this.angle = Math.random() * Math.PI * 2;
    this.radius = 200 + Math.random() * 300;
    this.lastMove = 0;
    this.teleports = 0;
    this.voicePort = 0;
    this.ws = null;            // the chat socket on the voice service
    this.wsDown = 0;           // bytes it read, since the last report
    this.wsUp = 0;             // bytes it sent, since the last report
    this.passSentAt = 0;
    this.welcomed = false;
    this.play = [];            // what it does besides walking: fight, host, trade
    this.others = new Map();   // idx -> { refrId, pos, cell }, the actors it was sent
    this.hosted = new Map();   // idx -> { pos, rot, cell }, the NPCs it carries out
    this.played = {};          // what it did and what came back, since the last report
    this.nextHit = 0;
    this.nextTrade = 0;
    this.anim = 0;
    this.nextQuest = 0;
    this.questPhase = 'idle';  // idle, asked (the panel), held (work taken), leaving
    this.questView = null;     // the newest panel the server pushed it
    this.questTook = '';       // the work it pressed Take on
    this.questGem = '';
    this.picked = false;       // it picked a trade for the work it saw
    this.atPanel = null;       // [x, y, z] it stands at while the panel is open
  }

  did(what, n) { this.played[what] = (this.played[what] || 0) + (n === undefined ? 1 : n); }

  // The position the bot's own character is at now.
  here() {
    if (this.atPanel) { return this.atPanel; }
    const c = this.center || [0, 0, 0];
    return [c[0] + Math.cos(this.angle) * this.radius, c[1] + Math.sin(this.angle) * this.radius, c[2]];
  }

  // The nearest actor it knows that keep(actor) holds for, within reach.
  nearest(reach, keep) {
    const me = this.here();
    let best = null; let bestD = reach;
    for (const [idx, o] of this.others) {
      if (o.cell !== this.cell || !keep(o)) { continue; }
      const d = distance(me, o.pos);
      if (d <= bestD) { best = Object.assign({ idx }, o); bestD = d; }
    }
    return best;
  }

  // A swing at another person near it, as the game sends one.
  swing(now) {
    const people = [];
    const me = this.here();
    for (const [, o] of this.others) {
      if (o.cell === this.cell && o.refrId >= PLAYER_IDS && o.refrId < 0x100000000 && distance(me, o.pos) <= FIGHT_REACH) { people.push(o); }
    }
    this.nextHit = now + 2000 + Math.random() * 1000;
    if (!people.length) { this.did('noOneToHit'); return; }
    const target = people[Math.floor(Math.random() * people.length)];
    this.send({ t: UPDATE_ANIMATION, idx: this.character.idx, data: { animEventName: 'attackStart', numChanges: ++this.anim } }, true);
    this.send({ t: ON_HIT, data: { aggressor: 0x14, isBashAttack: false, isHitBlocked: false, isPowerAttack: false, isSneakAttack: false,
      projectile: 0, source: UNARMED, target: target.refrId } }, true);
    this.did('hits');
  }

  // "/merchant <id>" to the nearest NPC, over the chat socket.
  askTrade(now) {
    this.nextTrade = now + TRADE_EVERY_MS;
    const npc = this.nearest(TRADE_REACH, (o) => o.refrId >= 0x100000000);
    if (!npc) { this.did('noTraderNear'); return; }
    this.wsSend({ t: 'chat', text: '/merchant ' + (npc.refrId - 0x100000000).toString(16) });
    this.did('tradeAsks');
  }

  // What the chat socket brought that answers a quest press or a trade ask.
  heard(text) {
    const quest = this.play.indexOf('quest') >= 0;
    const trade = this.play.indexOf('trade') >= 0;
    if ((!quest && !trade) || text.indexOf('"t":"chat"') < 0) { return; }
    let said = '';
    try { said = String(JSON.parse(text).text || ''); } catch (e) { return; }
    if (quest && Object.prototype.hasOwnProperty.call(QUEST_SAID, said)) {
      const k = QUEST_SAID[said];
      this.did(k);
      if (k.indexOf('questRefused:') === 0) { this.did('questRefused'); }
      return;
    }
    if (!trade) { return; }
    if (/Trading with/.test(said)) { this.did('tradeOpened'); } else if (/not a guild trader/.test(said)) { this.did('notATrader'); } else if (/trade|trader/i.test(said)) { this.did('tradeOtherAnswer'); }
  }

  // One press at the trader panel, the way the panel's buttons send them;
  // now is Date.now(). See quest in the header.
  questStep(now) {
    const say = (line) => this.wsSend({ t: 'chat', text: line });
    const end = () => { say('/merchant close'); this.atPanel = null; this.questPhase = 'idle'; this.questView = null; this.nextQuest = now + QUEST_EVERY_MS; };
    this.nextQuest = now + QUEST_STEP_MS;
    if (this.questPhase === 'idle') {
      const npc = this.nearest(QUEST_REACH, (o) => o.refrId >= 0x100000000);
      if (!npc) { this.did('questNoTraderNear'); this.nextQuest = now + QUEST_EVERY_MS; return; }
      this.atPanel = this.here();
      this.questView = null;
      say('/merchant ' + (npc.refrId - 0x100000000).toString(16));
      this.questPhase = 'asked';
      this.did('questPanelAsks');
      return;
    }
    const quests = this.questView && this.questView.open !== false && Array.isArray(this.questView.quests) ? this.questView.quests : null;
    if (this.questPhase === 'asked') {
      if (!quests) { this.did('questNoPanel'); end(); return; }
      const held = quests.find((q) => q && q.state === 'open' && q.canAbandon);
      if (held) { this.leave(held, say); this.questPhase = 'leaving'; return; }
      const take = quests.find((q) => q && q.canTake === true);
      if (take) {
        const quote = take.kind === 'commission' && typeof take.quoteToken === 'string' && /^[0-9a-f]{64}$/.test(take.quoteToken) ? take.quoteToken
          : take.kind === 'commission' && Number.isSafeInteger(take.quotedUnit) && take.quotedUnit >= 0 ? String(take.quotedUnit) : '';
        const gems = Array.isArray(take.gems) ? take.gems : [];
        this.questGem = quote ? '' : (gems[0] || '');
        say('/merchant quest take ' + take.id + (quote ? ' @' + quote : this.questGem ? ' ' + this.questGem : ''));
        this.questTook = String(take.id);
        this.questPhase = 'held';
        this.did('questTakeAsks');
        return;
      }
      const trade = this.picked ? null : quests.map((q) => String(q && q.who || '').split(',').map((w) => w.trim().toLowerCase()))
        .find((w) => w.length === 3 && w[2] === 'novice' && w[0] !== 'mage' && /^[a-z]+$/.test(w[0]) && /^[a-z]+$/.test(w[1]));
      if (trade) {
        say('/pick profession ' + trade[0] + ' ' + trade[1]);
        this.picked = true;
        this.did('questPicks');
        this.questPhase = 'idle';
        return;
      }
      this.did('noQuestToTake');
      end();
      return;
    }
    if (this.questPhase === 'held') {
      const held = quests && quests.find((q) => q && String(q.id) === this.questTook && q.state === 'open' && q.canAbandon);
      if (!held) { this.did('questNotHeld'); end(); return; }
      this.leave(held, say);
      this.questPhase = 'leaving';
      return;
    }
    end();
  }

  // Leave work: the panel's second button on work that is open.
  leave(q, say) {
    const token = Number.isSafeInteger(q.token) && q.token > 0 ? ' @' + q.token : (q.gem ? ' ' + q.gem : this.questGem ? ' ' + this.questGem : '');
    say('/merchant quest abandon ' + q.id + token);
    this.did('questLeaveAsks');
  }

  // The chat socket, once the character is in: a token, then the socket.
  // Any failure fails the bot with what it was.
  openVoice() {
    const body = JSON.stringify({ profileId: Number(this.profileId), ticket: 'load-test' });
    const req = http.request({ host: '127.0.0.1', port: this.voicePort, path: '/token', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) { this.fail('the voice service gave no token: HTTP ' + res.statusCode + ' ' + text.slice(0, 120)); return; }
        let token = '';
        try { token = String(JSON.parse(text).token || ''); } catch (e) { token = ''; }
        if (!token) { this.fail('the voice service\'s token answer has no token: ' + text.slice(0, 120)); return; }
        if (this.step === 'failed') { return; }
        const ws = new WebSocket('ws://127.0.0.1:' + this.voicePort + '/', ['thornswood', token]);
        this.ws = ws;
        ws.onopen = () => { this.wsSend({ t: 'join', profileId: Number(this.profileId), name: 'Load ' + this.profileId, voice: false }); };
        ws.onmessage = (ev) => {
          const t = String(ev.data);
          this.wsDown += Buffer.byteLength(t);
          if (!this.welcomed && t.startsWith('{"t":"welcome"')) { this.welcomed = true; this.sendPass(Date.now()); }
          this.heard(t);
        };
        ws.onerror = () => { if (this.step !== 'failed') { this.fail('the chat socket on the voice service failed'); } };
        ws.onclose = (ev) => { if (this.step !== 'failed' && this.step !== 'closing') { this.fail('the voice service closed the chat socket with ' + ev.code); } };
      });
    });
    req.on('error', (e) => this.fail('the voice service did not answer for a token: ' + e.message));
    req.end(body);
  }

  wsSend(o) {
    const t = JSON.stringify(o);
    this.wsUp += Buffer.byteLength(t);
    this.ws.send(t);
  }

  // A new pass, as the site signs one every minute, sent the front plugin's way.
  sendPass(now) {
    const pass = mintPass(this.passKey, { p: Number(this.profileId), s: this.server, v: 'load-test', d: 'load-' + this.profileId, i: now, x: now + 600000 });
    this.wsSend({ t: 'chat', text: '/joinpass ' + pass });
    this.passSentAt = now;
  }

  pump() {
    if (!this.client) { return; }
    for (const e of this.client.tick()) {
      if (e.type === 'connectionAccepted') { this.state = 'connected'; continue; }
      if (e.type === 'connectionDenied' || e.type === 'connectionFailed') { this.state = 'refused'; this.refusal = e.type + (e.error ? ': ' + e.error : ''); continue; }
      if (e.type === 'disconnect') { this.state = 'closed'; continue; }
      if (e.type !== 'message') { continue; }
      const m = e.message;
      this.all++;
      const t = m && typeof m.t === 'number' ? m.t : 'raw';
      this.counts[t] = (this.counts[t] || 0) + 1;
      if (!m) { continue; }
      if (m.t === MSG.CreateActor && m.isMe && !this.character) { this.character = m; }
      if (m.t === MSG.UpdateProperty && m.propName === MERCHANT_VIEW && this.character && m.idx === this.character.idx && this.play.indexOf('quest') >= 0) {
        let v = null;
        try { v = JSON.parse(m.dataDump); } catch (err) { v = null; }
        if (v && typeof v === 'object') {
          this.questView = v;
          this.did('questViews');
          if (Array.isArray(v.quests)) { this.did('questRowsSeen', v.quests.length); this.did('questRowsTakeable', v.quests.filter((q) => q && q.canTake === true).length); }
        }
      }
      if (m.t === MSG.CreateActor && !m.isMe && this.play.length) {
        const tr = m.transform || {};
        if (Array.isArray(tr.pos)) { this.others.set(m.idx, { refrId: Number(m.refrId) || 0, pos: tr.pos.map(Number), rot: Array.isArray(tr.rot) ? tr.rot.map(Number) : [0, 0, 0], cell: Number(tr.worldOrCell) || 0 }); }
      }
      if (m.t === MSG.UpdateMovement && this.play.length && m.data && Array.isArray(m.data.pos)) {
        const o = this.others.get(m.idx);
        if (o) { o.pos = m.data.pos.map(Number); if (typeof m.data.worldOrCell === 'number') { o.cell = m.data.worldOrCell; } }
      }
      if (m.t === MSG.DestroyActor && this.play.length) { this.others.delete(m.idx); this.hosted.delete(m.idx); }
      if (m.t === HOST_START && this.play.indexOf('host') >= 0) {
        let found = false;
        for (const [idx, o] of this.others) {
          if (o.refrId === Number(m.target)) { this.hosted.set(idx, { pos: o.pos.slice(), rot: o.rot.slice(), cell: o.cell }); found = true; break; }
        }
        this.did(found ? 'hostStarts' : 'hostStartsNotSeen');
      }
      if (m.t === HOST_STOP && this.play.indexOf('host') >= 0) {
        for (const [idx, o] of this.others) { if (o.refrId === Number(m.target)) { this.hosted.delete(idx); } }
        this.did('hostStops');
      }
      if (m.t === MSG.CustomPacket && typeof m.contentJsonDump === 'string' && m.contentJsonDump.indexOf('thornswoodLoginChallenge') >= 0) {
        let c = null;
        try { c = JSON.parse(m.contentJsonDump); } catch (err) { this.fail('a login challenge that does not read as JSON'); return; }
        this.onCustom(c);
      }
      if ((m.t === TELEPORT && this.character && m.idx === this.character.idx) || m.t === TELEPORT2) {
        if (Array.isArray(m.pos) && m.pos.length === 3) { this.center = m.pos.map(Number); }
        if (typeof m.worldOrCell === 'number') { this.cell = m.worldOrCell; }
        if (typeof m.teleportSeq === 'number') { this.seq = m.teleportSeq; }
        this.teleports++;
      }
    }
  }

  fail(why) {
    if (this.step === 'failed') { return; }
    this.step = 'failed'; this.why = why;
    try { this.close(); } catch (e) { this.why += ' (and closing it said ' + e.message + ')'; }
    if (this.ws) { this.ws.close(); }
  }

  // One pass of this bot's steps; now is Date.now().
  advance(now) {
    if (this.step === 'failed' || this.step === 'closing') { return; }
    if (this.step === 'moving' && this.voicePort && !this.welcomed && now > this.voiceBy) { this.fail('the voice service did not welcome the chat socket in ' + STEP_MS / 1000 + ' s'); return; }
    if (this.state === 'refused') { this.fail('refused: ' + this.refusal); return; }
    if (this.state === 'closed' && this.step !== 'new') { this.fail('the server closed the connection at step ' + this.step); return; }
    if (this.step !== 'moving' && this.deadline && now > this.deadline) { this.fail('no answer at step ' + this.step + ' in ' + STEP_MS / 1000 + ' s'); return; }
    if (this.step === 'connecting' && this.state === 'connected') {
      if (this.passKey) {
        const at = Date.now();
        const pass = mintPass(this.passKey, { p: Number(this.profileId), s: this.server, v: 'load-test', d: 'load-' + this.profileId, i: at, x: at + 4 * 3600000 });
        this.pass = { pass, loginKey: passLoginKey(this.passKey, pass) };
      }
      this.sendCustom({ customPacketType: 'loginWithSkympIo', gameData: { profileId: Number(this.profileId) } });
      this.step = 'login'; this.deadline = now + STEP_MS;
      return;
    }
    if (this.step === 'login' && this.character) {
      const tr = this.character.transform || {};
      this.center = Array.isArray(tr.pos) ? tr.pos.map(Number) : [0, 0, 0];
      this.cell = Number(tr.worldOrCell) || 0;
      if ((this.character.props || {}).isRaceMenuOpen === true) {
        this.send({ t: 4, idx: this.character.idx, data: face('Load ' + this.profileId) }, true);
      }
      this.step = 'moving'; this.deadline = 0; this.lastMove = now - Math.random() * MOVE_MS;
      this.nextHit = now + 5000 + Math.random() * 3000; this.nextTrade = now + 10000 + Math.random() * TRADE_EVERY_MS;
      this.nextQuest = now + 10000 + Math.random() * QUEST_EVERY_MS;
      if (this.voicePort) { this.voiceBy = now + STEP_MS; this.openVoice(); }
      return;
    }
    if (this.step === 'moving' && this.welcomed && now - this.passSentAt >= PASS_EVERY_MS) { this.sendPass(now); }
    if (this.step === 'moving' && now - this.lastMove >= MOVE_MS) {
      const dt = MOVE_MS / 1000;
      // On the beat, unless the bot fell a whole beat behind, which starts
      // the beat again from now rather than sending the missed ones at once.
      this.lastMove = now - this.lastMove >= 2 * MOVE_MS ? now : this.lastMove + MOVE_MS;
      // At an open trader panel it stands where it opened it, as a person does.
      if (!this.atPanel) { this.angle += (WALK * dt) / this.radius; }
      const pos = this.here();
      const heading = ((this.angle * 180 / Math.PI) + 90) % 360;
      this.send({ t: MSG.UpdateMovement, idx: this.character.idx, data: {
        worldOrCell: this.cell, pos, rot: [0, 0, heading], direction: 0, healthPercentage: 1, speed: this.atPanel ? 0 : WALK,
        runMode: this.atPanel ? 'Standing' : 'Walking', isInJumpState: false, isSneaking: false, isBlocking: false, isWeapDrawn: this.play.indexOf('fight') >= 0, isDead: false,
        teleportSeq: this.seq
      } }, false);
      for (const [idx, h] of this.hosted) {
        this.send({ t: MSG.UpdateMovement, idx, data: {
          worldOrCell: h.cell, pos: h.pos, rot: h.rot, direction: 0, healthPercentage: 1, speed: 0,
          runMode: 'Standing', isInJumpState: false, isSneaking: false, isBlocking: false, isWeapDrawn: false, isDead: false
        } }, false);
        this.did('hostMoves');
      }
    }
    if (this.step === 'moving' && this.play.indexOf('fight') >= 0 && now >= this.nextHit) { this.swing(now); }
    if (this.step === 'moving' && this.welcomed && this.play.indexOf('trade') >= 0 && now >= this.nextTrade) { this.askTrade(now); }
    if (this.step === 'moving' && this.welcomed && this.play.indexOf('quest') >= 0 && now >= this.nextQuest) { this.questStep(now); }
  }
}

// The load copy's own pass key and the name its passes carry: door.json in
// its privDir, and thornswoodServer ("main" when unset, as the gamemode reads
// it).
function passKeyOf(root) {
  const settings = JSON.parse(String(fs.readFileSync(path.join(root, 'server-settings.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const door = JSON.parse(String(fs.readFileSync(path.join(root, String(settings.privDir || 'private'), 'door.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (!door.passKey) { throw new Error('door.json in ' + root + ' has no passKey, so no bot can hold a join pass there'); }
  return { passKey: String(door.passKey), server: String(settings.thornswoodServer || '').trim().toLowerCase() || 'main' };
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) { o[String(argv[i]).replace(/^--/, '')] = argv[i + 1]; }
  return o;
}

function main() {
  const a = args(process.argv.slice(2));
  if (!a.root || !a.port || !process.send) {
    console.log('node load-bots.js --root <server folder> --port <proxy port> [--password <p>] [--voice <voice service port>] [--play fight,host,trade,quest], started by Load-Test.js with IPC');
    process.exit(2);
  }
  const addon = loadAddon(a.root);
  const playing = String(a.play || '').split(',').filter(Boolean);
  const { passKey, server } = passKeyOf(a.root);
  const bots = [];
  let cpu0 = process.cpuUsage();
  let at0 = Date.now();
  process.on('message', (msg) => {
    if (msg && Array.isArray(msg.add)) {
      for (const id of msg.add) {
        const b = new LoadBot(addon, { host: '127.0.0.1', port: Number(a.port), password: a.password || '', name: 'load ' + id });
        b.profileId = id; b.passKey = passKey; b.server = server; b.voicePort = Number(a.voice) || 0; b.play = playing;
        try {
          b.client = addon.createBotClient(b.host, b.port, b.password, b.timeoutMs);
          b.state = 'connecting'; b.step = 'connecting'; b.deadline = Date.now() + STEP_MS;
        } catch (e) { b.fail('createBotClient: ' + e.message); }
        bots.push(b);
      }
    }
    if (msg && msg.report) {
      const now = Date.now();
      const cpu = process.cpuUsage(cpu0);
      const steps = {};
      const counts = {};
      const failed = [];
      let teleports = 0;
      let wsDown = 0; let wsUp = 0; let inVoice = 0;
      let all = 0;
      const perBot = [];
      const play = {};
      let hostedNow = 0;
      // The NPCs the bots hold as sent to them at the report, and how many of
      // those are in the bot's own cell, where a trade ask can reach them. The
      // box's crowd in the Frozen Hearth found no trader at any step (8 Nov
      // 2026, #4623) and nothing said whether any NPC was sent at all.
      let npcsKnown = 0; let npcsInCell = 0;
      for (const b of bots) {
        steps[b.step] = (steps[b.step] || 0) + 1;
        if (b.step === 'failed') { failed.push({ profileId: b.profileId, why: b.why }); }
        for (const k of Object.keys(b.counts)) { counts[k] = (counts[k] || 0) + b.counts[k]; }
        if (b.step === 'moving') { perBot.push(b.counts[MSG.UpdateMovement] || 0); }
        b.counts = {};
        teleports += b.teleports; all += b.all;
        wsDown += b.wsDown; wsUp += b.wsUp; b.wsDown = 0; b.wsUp = 0;
        if (b.step === 'moving' && b.welcomed) { inVoice++; }
        for (const k of Object.keys(b.played)) { play[k] = (play[k] || 0) + b.played[k]; }
        b.played = {};
        hostedNow += b.hosted.size;
        for (const [, o] of b.others) {
          if (o.refrId >= 0x100000000) { npcsKnown++; if (o.cell === b.cell) { npcsInCell++; } }
        }
      }
      process.send({ report: { ms: now - at0, cpuMs: (cpu.user + cpu.system) / 1000, steps, counts, failed, teleports, all, movesReadPerBot: perBot, cores: os.cpus().length, wsDown, wsUp, inVoice, play: Object.assign(play, playing.length ? { hostedNow, npcsKnown, npcsInCell } : {}) } });
      cpu0 = process.cpuUsage(); at0 = now;
    }
    if (msg && msg.stop) {
      for (const b of bots) { if (b.step !== 'failed') { b.step = 'closing'; } if (b.client) { b.close(); } if (b.ws) { b.ws.close(); } }
      process.exit(0);
    }
  });
  process.on('disconnect', () => process.exit(0));
  const loop = () => {
    const now = Date.now();
    for (const b of bots) {
      if (b.step === 'failed') { continue; }
      try { b.pump(); b.advance(now); } catch (e) { b.fail(e.message); }
    }
    setTimeout(loop, 5);
  };
  loop();
}

if (require.main === module) { main(); }

module.exports = { LoadBot, MOVE_MS, passKeyOf, UNARMED, FIGHT_REACH, TRADE_REACH, QUEST_REACH, QUEST_SAID, MERCHANT_VIEW };
