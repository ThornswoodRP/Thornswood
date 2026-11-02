#!/usr/bin/env node
// scripts/bot/Bot-Pass.js
//
// #5196. The bot pass a dev deploy waits on. The box deploy agent (#5180)
// makes a throwaway copy of the dev server with the gamemode it is about to
// put on dev (tools/DeployAgent/BotPass.cs), and starts this in that copy as
// a task of its own with no rights outside it. This starts that server,
// plays the parts of the game a bot can reach over the game port and over
// the voice service's relay (a copy of its own, beside the server), stops
// them, and writes what happened. A FAIL in it fails the Deployment and the
// gamemode does not go on dev.
//
//     node Bot-Pass.js --root <server folder> --out <result.json> [--id <run id>]
//
// What it checks, each a line in the result:
//   loads      the server starts, says this folder's gamemode.js loaded (the
//              git blob it names is this file's), and takes a connection;
//   login      a bot logs in as a profile nobody has, the way the game does,
//              and is sent its character (createActor with isMe);
//   relay      the bot joins the voice service with a join token from its
//              /token, the way the game's chat page does, and sends its join
//              pass over it, which the gamemode takes (relay.js; the pass is
//              signed with a key this copy alone has, in its private folder);
//   new        that character is new: it is sent with the race menu open
//              and with creation already open (the thornswoodChargen
//              property at stage appearance), because gamemode.js opens
//              creation and dresses a new character before the engine hands
//              it over (__thornswoodChargen.created, spawn.ts);
//   face       the bot sends a face (UpdateAppearance) and the gamemode
//              moves the character on to choosing a home, which the bot is
//              told as thornswoodChargen at stage choosing (gamemode.js
//              onUpdateAppearanceAttempt, beginChoosing);
//   home       the bot picks a home town over the relay, as the K panel
//              does, and the gamemode ends creation (thornswoodChargen at
//              stage done) and welcomes it there, a line back over the relay;
//   needs      /needs over the relay is answered with the needs line;
//   saved      the world on disk holds the character with that name;
//   restart    the server is stopped and started again and loads again;
//   loads back a second bot logs in as the same profile and is sent the same
//              character: its name, where it stood, and no race menu.
// The server's own output goes to bot-pass-server.log beside it, and the
// last lines of it into the result, so a FAIL says what the server said. The
// voice service's goes to bot-pass-voice.log in its folder.
// The pass's own lines, each step as it starts and ends, go to bot-pass.log
// beside the result as they happen, so a pass that never ends says where it
// was (the task keeps no output of its own, and result.json is written only
// at the end; Deployment 7480554210 ran out with neither).
//
// The waits are on things the server says or writes, each with a time
// limit: nothing is sent twice, and nothing is put right after the fact.
'use strict';
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Bot, MSG, loadAddon, mintPass } = require('./bot.js');
const { VoiceRun, Relay } = require('./relay.js');
const { characters } = require('./character.js');

const LOADED = '[thornswood] gamemode client scripts ';
const NOT_LOADED = ['[thornswood] gamemode did not load', 'Bad syntax, ignoring'];
const BLOB = /gamemode\.js is git blob ([0-9a-f]{40})/;
// gamemode.js's creation lines (log('chargen', ...)), and the steps whose
// FAIL carries them.
const CHARGEN = '[thornswood] chargen ';
const CHARGEN_STEPS = ['new', 'face', 'home', 'saved'];
// The home the bot picks: a town in game/data/chargen.json, by its key.
const HOME = 'whiterun';
// The line the gamemode takes a join pass with (the join pass block, take).
const PASS_TAKEN = '[thornswood] join pass for profile ';
// A Nord, the race the game's own race menu opens on (NordRace,
// 0x13746:Skyrim.esm), with the shape unit/TestUtils.hpp sends.
const NORD = 0x13746;
// The gamemode's creation record, which its owner is sent (gamemode.js
// CHARGEN_PROPERTY, visible by the owner): in createActor among the
// properties, and after that as an UpdateProperty of its own.
const CHARGEN_PROPERTY = 'thornswoodChargen';

function stageFrom(dump) {
  try { const v = JSON.parse(dump); return v && typeof v.stage === 'string' ? v.stage : ''; } catch (e) { return ''; }
}
// The creation stage a createActor carries, or ''.
function stageIn(actor) {
  const props = Array.isArray(actor && actor.customPropsJsonDumps) ? actor.customPropsJsonDumps : [];
  const p = props.find((x) => x && x.propName === CHARGEN_PROPERTY);
  return p ? stageFrom(p.propValueJsonDump) : '';
}
// The creation stage an UpdateProperty for this character carries, or ''.
function stageOf(m, idx) {
  return m.t === MSG.UpdateProperty && m.idx === idx && m.propName === CHARGEN_PROPERTY ? stageFrom(m.dataDump) : '';
}

function readJson(file) {
  return JSON.parse(String(fs.readFileSync(file, 'utf8')).replace(/^﻿/, ''));
}

// git's id for a file's bytes, which the gamemode logs as it loads.
function gitBlob(file) {
  const b = fs.readFileSync(file);
  return crypto.createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
}

function face(name) {
  return {
    isFemale: false, raceId: NORD, weight: 50, skinColor: -1, hairColor: -1,
    headpartIds: [], headTextureSetId: 0, tints: [], name,
    options: new Array(19).fill(0), presets: new Array(4).fill(0)
  };
}

// The character with this profile id in the world folder, or null. It is
// read as character.js reads every world (the restore rehearsal and the
// nightly count read the same way, #5287): the engine names a form's file by
// its id in hex (FormDesc::ToString with %x, FileDatabase), so a character
// made on the server is ff000800.json, never digits alone. Reading digits
// only is how the first pass to reach saved failed (#5379).
function formOf(root, settings, profileId) {
  let all = [];
  try { all = characters(root, settings); } catch (e) { return null; }
  const c = all.find((x) => x.profileId === profileId);
  return c ? c.form : null;
}

function nameIn(form) {
  if (!form || !form.appearanceDump) { return ''; }
  try {
    const a = typeof form.appearanceDump === 'string' ? JSON.parse(form.appearanceDump) : form.appearanceDump;
    return a && typeof a.name === 'string' ? a.name : '';
  } catch (e) { return ''; }
}

// One run of the server in root: node dist_back/skymp5-server.js, as the
// server's task starts it, its output kept and read line by line.
class ServerRun {
  constructor(root, spawn, logFile) {
    this.root = root;
    this.spawn = spawn;
    this.logFile = logFile;
    this.child = null;
    this.lines = [];
    this.tail = [];
    this.exited = null;
    this.partial = '';
  }

  start() {
    this.lines = [];
    this.exited = null;
    this.partial = '';
    this.child = this.spawn(this.root);
    const take = (chunk) => {
      const text = this.partial + String(chunk);
      const parts = text.split(/\r?\n/);
      this.partial = parts.pop();
      for (const l of parts) {
        this.lines.push(l);
        this.tail.push(l);
        if (this.tail.length > 60) { this.tail.shift(); }
        try { fs.appendFileSync(this.logFile, l + '\n'); } catch (e) { /* the result still holds the tail */ }
      }
    };
    this.child.stdout.on('data', take);
    this.child.stderr.on('data', take);
    this.child.on('exit', (code, signal) => { this.exited = { code, signal }; });
  }

  // Until the server says how the gamemode load went: '' when the gamemode
  // with this blob loaded, else why not.
  async awaitLoad(blob, ms) {
    const end = Date.now() + ms;
    let seen = 0;
    let said = '';
    for (;;) {
      for (; seen < this.lines.length; seen++) {
        const l = this.lines[seen];
        const m = BLOB.exec(l);
        if (m) { said = m[1]; continue; }
        if (l.indexOf(LOADED) >= 0) {
          if (said === blob) { return ''; }
          return said ? 'a different gamemode loaded, git blob ' + said + ', not ' + blob
            : 'a gamemode loaded without saying which it is';
        }
        if (NOT_LOADED.some((x) => l.indexOf(x) >= 0)) { return 'the gamemode did not load: ' + l.trim(); }
      }
      if (this.exited) { return 'the server ended (' + JSON.stringify(this.exited) + ') before the gamemode loaded'; }
      if (Date.now() > end) { return 'the server said nothing about the gamemode loading within ' + Math.round(ms / 1000) + ' s'; }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async stop(ms) {
    if (!this.child || this.exited) { return true; }
    this.child.kill();
    const end = Date.now() + ms;
    while (!this.exited && Date.now() < end) { await new Promise((r) => setTimeout(r, 50)); }
    return !!this.exited;
  }
}

function spawnNode(root) {
  return childProcess.spawn(process.execPath, ['dist_back/skymp5-server.js'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
}

// The copy's own join pass key, in its own private folder (privDir), which
// starts empty: the agent never copies dev's (BotPass.cs). The gamemode
// checks a join pass against it, and the bot signs its pass with it.
function doorKey(root, settings) {
  const dir = path.join(root, String(settings.privDir || 'private'));
  fs.mkdirSync(dir, { recursive: true });
  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dir, 'door.json'), JSON.stringify({ passKey: key }));
  return key;
}

// The pass. opts: { root, id, loadMs, stepMs, spawn, addon, profileId, log,
// voiceFrom (the voice files, the bot's own folder when unset), voiceDir
// (where the voice copy runs, <root>/../voice when unset) }.
// Returns { ok, lines: [{ step, ok, detail }], blob, tail }.
async function pass(opts) {
  const root = path.resolve(opts.root);
  const log = opts.log || (() => {});
  const loadMs = opts.loadMs || 600000;
  const stepMs = opts.stepMs || 60000;
  const lines = [];
  // A FAIL from the character on says what the gamemode's creation said
  // about it (the copy has nobody else on it), so the Deployment's log holds
  // the reason and nobody has to fetch the server's log off the box.
  const said = (step) => {
    if (!CHARGEN_STEPS.includes(step)) { return ''; }
    const c = server.lines.filter((l) => l.indexOf(CHARGEN) >= 0).slice(-3).map((l) => l.trim().slice(0, 300));
    return c.length ? '. The gamemode said: ' + c.join(' | ') : '. The gamemode said nothing about creating it';
  };
  const say = (step, ok, detail) => {
    if (!ok) { detail += said(step); }
    lines.push({ step, ok, detail }); log((ok ? 'PASS  ' : 'FAIL  ') + step + ': ' + detail); return ok;
  };
  const settings = readJson(path.join(root, 'server-settings.json'));
  const port = Number(settings.port);
  const password = settings.password === undefined ? '' : String(settings.password);
  const blob = gitBlob(path.join(root, 'gamemode.js'));
  // A profile no real character has: the agent's throwaway world starts
  // empty, and the number says it was a bot.
  const profileId = opts.profileId || 1900000000 + crypto.randomInt(0, 90000000);
  const name = 'Bot Pass ' + profileId;
  const server = new ServerRun(root, opts.spawn || spawnNode, path.join(root, 'bot-pass-server.log'));
  const voice = new VoiceRun({ from: opts.voiceFrom || __dirname, dir: opts.voiceDir || path.join(path.dirname(root), 'voice'),
                               port: Number(settings.thornswoodVoicePort), log });
  const result = () => ({ ok: lines.length > 0 && lines.every((l) => l.ok), lines, blob, profileId,
                          tail: server.tail.slice(), voiceTail: voice.tail.slice() });
  const bots = [];
  const relays = [];
  let why = '';
  // A FAIL on the relay says what the voice service said last.
  const voiceSaid = () => voice.tail.length ? '. The voice service said: ' + voice.tail.slice(-3).map((l) => l.trim().slice(0, 300)).join(' | ') : '';
  try {
    if (!(port > 0)) { say('loads', false, 'server-settings.json names no port'); return result(); }
    if (settings.thornswoodRequirePass !== false) {
      say('loads', false, 'this server holds every login for a join pass (thornswoodRequirePass is not false), so it is not a bot pass copy');
      return result();
    }
    log('loading the engine\'s addon, scam_native.node');
    const addon = opts.addon || loadAddon(root);
    const key = doorKey(root, settings);

    // The voice service first, as on the box: the gamemode pushes positions
    // to it and collects commands from it from the moment it loads.
    log('the voice service starts beside the copy');
    why = await voice.start(stepMs);
    if (why) { say('loads', false, 'the voice service beside the copy did not start: ' + why + voiceSaid()); return result(); }

    server.start();
    log('the server started; it has ' + Math.round(loadMs / 1000) + ' s to say gamemode.js loaded');
    why = await server.awaitLoad(blob, loadMs);
    if (!say('loads', why === '', why || 'gamemode.js, git blob ' + blob.slice(0, 12) + ', loaded')) { return result(); }

    const first = new Bot(addon, { port, password, name: 'bot', log });
    bots.push(first);
    try {
      log('a bot connects to port ' + port);
      await first.connect(stepMs);
      const me = await first.login(profileId, null, stepMs);
      say('login', me.isMe === true, 'profile ' + profileId + ' was sent its character, idx ' + me.idx);
    } catch (e) { say('login', false, e.message); return result(); }
    const me = first.character;

    // The relay, as the game's chat page joins it, and the join pass the
    // launcher sends over it, which every session needs within three minutes
    // or the gamemode ends it (the join pass block, sweep).
    const relay = new Relay(voice, { profileId, name: 'bot', log });
    relays.push(relay);
    try {
      log('the bot joins the voice service and sends its join pass');
      await relay.connect(stepMs);
      const now = Date.now();
      const serverName = String(settings.thornswoodServer || '').trim().toLowerCase() || 'main';
      const jp = mintPass(key, { p: profileId, s: serverName, v: 'bot pass', d: 'bot-' + profileId, i: now, x: now + 3600000 });
      const seenAt = server.lines.length;
      relay.say('/joinpass ' + jp);
      await first.until(() => server.lines.slice(seenAt).some((l) => l.indexOf(PASS_TAKEN + profileId) >= 0),
        stepMs, 'word from the gamemode that it took the join pass sent over the relay');
      say('relay', true, 'the bot joined the voice service with a join token and the gamemode took its join pass over it');
    } catch (e) {
      const refused = server.lines.filter((l) => l.indexOf('[thornswood] join pass from profile ' + profileId) >= 0).slice(-1);
      say('relay', false, e.message + (refused.length ? '. The gamemode said: ' + refused[0].trim().slice(0, 300) : '') + voiceSaid());
      return result();
    }
    const props = me.props || {};
    if (props.isRaceMenuOpen !== true) {
      say('new', false, 'the character was sent with the race menu ' + (props.isRaceMenuOpen === undefined ? 'not named' : 'closed') + ', so it was not made new');
      return result();
    }
    // Creation is open from the first packet: the gamemode opens it before
    // the engine hands the character over, so the stage comes in createActor
    // among the properties its owner may see. Its plain clothes are already
    // in the pack there too, so no later inventory message says creation
    // began; waiting for one is how the second real pass (Deployment
    // 7476990469) failed at new.
    const stage = stageIn(me);
    if (!say('new', stage === 'appearance', stage === 'appearance'
      ? 'a new character: the race menu is open and creation is open at the face'
      : (stage ? 'the character came with creation at stage ' + stage + ', not appearance, so the gamemode did not make it new'
        : 'the character came with no creation stage, so the gamemode did not open creation for it'))) {
      return result();
    }

    // What moves creation on is the gamemode setting the stage to choosing
    // when the face lands. The race menu's close is not sent: the engine
    // closes it as it takes the face (ActionListener::OnUpdateAppearance),
    // the game closed its own menu before it sent one, and the gamemode's
    // closeRaceMenu then finds it closed and sends nothing
    // (PartOne::SetRaceMenuOpen). Waiting for that close is how the first
    // real pass (Deployment 7475814060) failed at face.
    const sentAt = first.inbox.length;
    log('the bot sends a face');
    first.send({ t: 4, idx: me.idx, data: face(name) }, true);
    try {
      await first.until(() => first.inbox.slice(sentAt).some((x) => x.message && stageOf(x.message, me.idx) === 'choosing'),
        stepMs, 'creation moving on to choosing after the face was sent');
      say('face', true, 'the face was taken and creation moved on to choosing a home');
    } catch (e) { say('face', false, e.message); return result(); }

    // The home, picked over the relay as the K panel picks it. The gamemode
    // ends creation (arriveAt) and says the welcome over the relay.
    let heardAt = relay.heard.length;
    const inboxAt = first.inbox.length;
    log('the bot picks its home, ' + HOME);
    relay.say('/pick town ' + HOME);
    try {
      await first.until(() => first.inbox.slice(inboxAt).some((x) => x.message && stageOf(x.message, me.idx) === 'done'),
        stepMs, 'creation ending after the home was picked over the relay');
      await relay.until(() => relay.said(heardAt).some((t) => /^Welcome to /.test(t)), stepMs, 'the welcome over the relay');
      say('home', true, 'the home was picked over the relay, creation ended and the gamemode said: ' +
        relay.said(heardAt).find((t) => /^Welcome to /.test(t)));
    } catch (e) {
      const back = relay.said(heardAt);
      say('home', false, e.message + (back.length ? '. Over the relay it was told: ' + back.slice(-2).join(' | ').slice(0, 300) : ''));
      return result();
    }

    heardAt = relay.heard.length;
    log('the bot asks for its needs');
    relay.say('/needs');
    try {
      const line = await relay.until(() => relay.said(heardAt).find((t) => /^Hunger \d+% /.test(t)), stepMs, 'an answer to /needs over the relay');
      say('needs', true, 'the needs answered over the relay: ' + line.slice(0, 200));
    } catch (e) {
      const back = relay.said(heardAt);
      say('needs', false, e.message + (back.length ? '. Over the relay it was told: ' + back.slice(-2).join(' | ').slice(0, 300) : ''));
      return result();
    }
    relay.close();

    let form = null;
    log('waiting for the world on disk to hold ' + name);
    const end = Date.now() + stepMs;
    while (Date.now() < end) {
      form = formOf(root, settings, profileId);
      if (form && nameIn(form) === name) { break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!say('saved', !!form && nameIn(form) === name, form
      ? (nameIn(form) === name ? 'the world holds ' + name : 'the world holds the character as "' + nameIn(form) + '", not ' + name)
      : 'the world holds no character for profile ' + profileId + ' after ' + Math.round(stepMs / 1000) + ' s')) {
      return result();
    }
    first.close();

    log('the server is stopped');
    if (!await server.stop(stepMs)) { say('restart', false, 'the server did not end within ' + Math.round(stepMs / 1000) + ' s of being stopped'); return result(); }
    // What it was saved as, read once it has ended and written its last.
    form = formOf(root, settings, profileId) || form;
    server.start();
    log('the server started again; it has ' + Math.round(loadMs / 1000) + ' s to say gamemode.js loaded');
    why = await server.awaitLoad(blob, loadMs);
    if (!say('restart', why === '', why || 'stopped, started again, and the gamemode loaded again')) { return result(); }

    const second = new Bot(addon, { port, password, name: 'bot again', log });
    bots.push(second);
    try {
      log('a second bot connects to port ' + port);
      await second.connect(stepMs);
      const again = await second.login(profileId, null, stepMs);
      const p = again.props || {};
      const got = again.appearance || p.appearance;
      const pos = (again.transform || {}).pos || [];
      const want = form.position || [];
      const near = want.length === 3 && pos.length === 3 && want.every((x, i) => Math.abs(Number(x) - Number(pos[i])) <= 1);
      const wrong = [];
      if (!got || got.name !== name) { wrong.push('its name is ' + JSON.stringify(got ? got.name : undefined) + ', not ' + name); }
      if (!near) { wrong.push('it stands at ' + JSON.stringify(pos) + ', and the world saved ' + JSON.stringify(want)); }
      if (p.isRaceMenuOpen === true) { wrong.push('the race menu is open again'); }
      say('loads back', wrong.length === 0, wrong.length ? wrong.join('; ') : name + ' came back where it was saved, with no race menu');
    } catch (e) { say('loads back', false, e.message); }
    return result();
  } catch (e) {
    say('pass', false, 'the pass itself failed: ' + (e && e.stack || e));
    return result();
  } finally {
    for (const b of bots) { try { b.close(); } catch (e) { /* closing a closed bot */ } }
    for (const r of relays) { r.close(); }
    log('the pass ends; the server is stopped');
    await server.stop(stepMs);
    await voice.stop(stepMs);
  }
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)$/.exec(argv[i]);
    if (!m || i + 1 >= argv.length) { throw new Error('what is "' + argv[i] + '"? Use --root, --out and --id.'); }
    o[m[1]] = argv[++i];
  }
  return o;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.root || !a.out) {
    console.log('node Bot-Pass.js --root <server folder> --out <result.json> [--id <run id>]');
    return 2;
  }
  const started = new Date().toISOString();
  // Fresh for each pass: the agent empties the run folder before it starts one.
  const progress = path.join(path.dirname(path.resolve(a.out)), 'bot-pass.log');
  const log = (s) => {
    const l = new Date().toISOString() + '  ' + s;
    console.log(l);
    try { fs.appendFileSync(progress, l + '\n'); } catch (e) { /* the result still holds the steps */ }
  };
  log('the bot pass starts in ' + path.resolve(a.root));
  const r = await pass({ root: a.root, log });
  const doc = Object.assign({ schema: 1, id: a.id || '', started, ended: new Date().toISOString() }, r);
  // Whole or not at all: the agent reads this file once the task has ended.
  const tmp = a.out + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
  fs.renameSync(tmp, a.out);
  log(r.ok ? 'BOT PASS OK' : 'BOT PASS FAILED');
  return r.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (e) => { console.log('BOT PASS FAILED: ' + (e && e.stack || e)); process.exit(1); });
}

module.exports = { stageIn, stageOf, pass, gitBlob, face, formOf, nameIn, ServerRun, doorKey, HOME };
