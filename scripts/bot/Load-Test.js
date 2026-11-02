#!/usr/bin/env node
// scripts/bot/Load-Test.js
//
// #4623. How much one person costs the game server, measured with network
// bots (Patrick, 20 Oct: bots that connect over the game's port, log in and
// move like a person; not bots inside the server). It starts the server in
// a load copy, then puts more and more bots on it, and at each step reads
// what the server process used and what crossed the network:
//
//   cores   the server process's CPU time over the step's window, divided by
//           the window (load-sampler.js, inside the server, every thread);
//   memory  the server process's private bytes (its commit, which Windows
//           cannot trim) at the end of the window, read from outside with
//           Get-Process, and its working set beside it. The working set
//           alone misleads: measured on run 41353332627 it fell from 872 MB
//           with nobody on to 156 MB with 20, as Windows trimmed it;
//   bytes   every datagram between the bots and the server, each way
//           (load-proxy.js), and on the wire with 28 bytes of IPv4 and UDP
//           header on each.
//
// A person is also a chat socket on the voice service, which carries their
// join pass (load-bots.js, step 5), so the load copy runs the voice service
// from this checkout too (voice/voice-server.js, on the port the settings
// name, with chat range on as Install-Voice.ps1 installs it), with the same
// sampler in it, and a stand-in for the site that answers yes to every
// token's ticket, as voice/load-voice.js does: the site is not what is
// measured. The voice service's cores, memory and socket bytes are columns
// of their own.
//
// Each step is first held until every bot of it is walking (load-bots.js
// says what a bot does), then left to settle, then measured over a window.
// Step 0 is the server with nobody on it, which the per person numbers are
// taken against. A step whose runner was nearly out of CPU, or where a bot
// could not get in, says so in the result, and the test stops there: past
// that point the numbers are the runner's, not the server's.
//
//     node Load-Test.js --root <server folder> --out <result.json>
//         [--steps 10,20,40,60,80,100] [--settle 20] [--hold 60] [--workers 3]
//         [--shape crowd] [--summary <markdown file>]
//         [--play fight,host,trade] [--busy 0.6] [--watch <online.json url>,...]
//
// --play is what the bots do besides walking (load-bots.js). --busy is the
// share of the machine's CPU a step stops at (0.9 on a runner of its own; the
// box shares it with the game servers). --watch names the online.json of each
// server people play on: anybody on one, or one that does not answer, stops
// the run before its next step (Load-Box.ps1 on the box).
//
// Exit 0 when every step it got to was measured, 1 when the server did not
// load, ended, or a measurement could not be made.
'use strict';
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { ServerRun, gitBlob } = require('./Bot-Pass.js');
const { passKeyOf } = require('./load-bots.js');

const HEADER = 28;           // IPv4 (20) and UDP (8) header bytes on each datagram
const BUSY = 0.9;            // the share of the runner's CPU past which a step is the runner's
const RAMP_PER_S = 4;        // logins a second while a step fills
const FILL_MS = 180000;      // how long a step may take to have every bot walking

function readJson(file) {
  return JSON.parse(String(fs.readFileSync(file, 'utf8')).replace(/^﻿/, ''));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// A stand-in for the site that answers yes to every question the voice
// service asks it (voice/load-voice.js's siteThatSaysYes): whose a ticket's
// profile is, is not what is measured here.
function siteThatSaysYes() {
  const http = require('http');
  return new Promise((ok) => {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'); });
    });
    server.listen(0, '127.0.0.1', () => ok({ server, url: 'http://127.0.0.1:' + server.address().port }));
  });
}

// The voice service from this checkout, in its own folder under the load
// copy, with the sampler in it; resolves once it says it listens.
function startVoice(root, port, site, sampler, sampleFile, log) {
  const dir = path.join(root, 'voice-service');
  fs.mkdirSync(dir, { recursive: true });
  const voiceDir = path.join(__dirname, '..', '..', 'voice');
  fs.copyFileSync(path.join(voiceDir, 'voice-server.js'), path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(voiceDir, 'headlines.js'), path.join(dir, 'headlines.js'));
  try { fs.unlinkSync(sampleFile); } catch (e) { if (e.code !== 'ENOENT') { throw e; } }
  const env = Object.assign({}, process.env, {
    THORNSWOOD_VOICE_PORT: String(port), THORNSWOOD_VOICE_BIND: '127.0.0.1', THORNSWOOD_SITE: site,
    THORNSWOOD_CHAT_RANGE: 'on', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'), THORNSWOOD_LOAD_SAMPLES: sampleFile
  });
  delete env.THORNSWOOD_VOICE_MOST;
  const proc = childProcess.spawn(process.execPath, ['-r', sampler, 'voice-server.js'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const logFile = path.join(root, 'load-test-voice.log');
  let said = '';
  const take = (d) => { said += String(d); try { fs.appendFileSync(logFile, String(d)); } catch (e) { log('the voice log could not be written: ' + e.message); } };
  proc.stdout.on('data', take);
  proc.stderr.on('data', take);
  return new Promise((ok, bad) => {
    const late = setTimeout(() => { clearInterval(look); bad(new Error('the voice service did not say it listens within 30 s:\n' + said.slice(-2000))); }, 30000);
    const look = setInterval(() => {
      if (new RegExp('listening on \\S+:' + port).test(said)) { clearTimeout(late); clearInterval(look); ok(proc); }
    }, 50);
    proc.on('exit', (c) => { clearTimeout(late); clearInterval(look); bad(new Error('the voice service stopped (exit ' + c + '):\n' + said.slice(-2000))); });
  });
}

// The server process's private bytes and working set, from outside it, in
// bytes: Windows only (Get-Process); elsewhere null, and the working set the
// sampler reads stands alone.
function processMemory(pid) {
  if (process.platform !== 'win32' || !pid) { return null; }
  const out = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$p = Get-Process -Id ' + Number(pid) + '; "$($p.PrivateMemorySize64) $($p.WorkingSet64) $($p.PeakWorkingSet64)"'],
  { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const n = String(out).trim().split(/\s+/).map(Number);
  if (n.length !== 3 || n.some((x) => !(x > 0))) { throw new Error('Get-Process said "' + String(out).trim() + '" for the server, not its memory'); }
  return { privateBytes: n[0], workingSet: n[1], peakWorkingSet: n[2] };
}

// The sampler's lines, oldest first.
function samples(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const l of text.split(/\r?\n/)) {
    if (!l) { continue; }
    try { out.push(JSON.parse(l)); } catch (e) { out.push({ unreadable: l.slice(0, 80) }); }
  }
  return out.filter((s) => typeof s.at === 'number');
}

// The runner's CPU, all cores, as busy and total milliseconds.
function machineCpu() {
  let busy = 0; let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    const sum = t.user + t.nice + t.sys + t.idle + t.irq;
    total += sum; busy += sum - t.idle;
  }
  return { busy, total };
}

// What one measured window says. a and b are the readings at its start and
// end: { at, server (a sample), proxy (a report), cpu (machineCpu) }, and
// bots the workers' reports over the window.
function windowOf(a, b, bots, people) {
  const vms = a.voice && b.voice ? b.voice.at - a.voice.at : 0;
  const voiceCores = vms > 0 ? (b.voice.user + b.voice.system - a.voice.user - a.voice.system) / 1000 / vms : null;
  const wsDown = bots.reduce((x, r) => x + (r.wsDown || 0), 0);
  const wsUp = bots.reduce((x, r) => x + (r.wsUp || 0), 0);
  const ms = b.at - a.at;
  const s = (b.server.user + b.server.system - a.server.user - a.server.system) / 1000;  // ms of CPU
  const sms = b.server.at - a.server.at;
  const up = b.proxy.up - a.proxy.up;
  const down = b.proxy.down - a.proxy.down;
  const upD = b.proxy.upDatagrams - a.proxy.upDatagrams;
  const downD = b.proxy.downDatagrams - a.proxy.downDatagrams;
  const sec = ms / 1000;
  const machine = (b.cpu.busy - a.cpu.busy) / Math.max(1, b.cpu.total - a.cpu.total);
  const botCpuMs = bots.reduce((x, r) => x + r.cpuMs, 0);
  const moves = [].concat(...bots.map((r) => r.movesReadPerBot || []));
  // Each walking bot sends a move every 130 ms, and the server passes each
  // one to every bot near it: in a crowd that is everybody else.
  return {
    people,
    seconds: Math.round(sec * 10) / 10,
    serverCores: sms > 0 ? s / sms : 0,
    voiceCores,
    voicePrivateMB: b.voiceMemory ? b.voiceMemory.privateBytes / 1048576 : null,
    voiceDownPerS: wsDown / ((b.at - a.at) / 1000),
    voiceUpPerS: wsUp / ((b.at - a.at) / 1000),
    serverRssMB: b.server.rss / 1048576,
    serverPrivateMB: b.memory ? b.memory.privateBytes / 1048576 : null,
    serverPeakWorkingSetMB: b.memory ? b.memory.peakWorkingSet / 1048576 : null,
    serverHeapMB: b.server.heap / 1048576,
    upBytesPerS: up / sec,
    downBytesPerS: down / sec,
    upWirePerS: (up + upD * HEADER) / sec,
    downWirePerS: (down + downD * HEADER) / sec,
    upDatagramsPerS: upD / sec,
    downDatagramsPerS: downD / sec,
    machineBusy: machine,
    botCores: botCpuMs / ms,
    movesReadPerBotPerS: moves.length ? moves.reduce((x, y) => x + y, 0) / moves.length / sec : 0,
    fewestMovesReadPerS: moves.length ? Math.min(...moves) / sec : 0
  };
}

// The per person numbers of a measured step against step 0.
function perPerson(w, base) {
  if (!w.people) { return null; }
  return {
    cores: (w.serverCores - base.serverCores) / w.people,
    memoryMB: w.serverPrivateMB !== null && base.serverPrivateMB !== null && w.serverPrivateMB !== undefined && base.serverPrivateMB !== undefined
      ? (w.serverPrivateMB - base.serverPrivateMB) / w.people : (w.serverRssMB - base.serverRssMB) / w.people,
    downKBps: w.downWirePerS / w.people / 1024,
    upKBps: w.upWirePerS / w.people / 1024,
    voiceCores: w.voiceCores !== null && w.voiceCores !== undefined && base.voiceCores !== null && base.voiceCores !== undefined ? (w.voiceCores - base.voiceCores) / w.people : null,
    voiceMemoryMB: w.voicePrivateMB !== null && w.voicePrivateMB !== undefined && base.voicePrivateMB !== null && base.voicePrivateMB !== undefined ? (w.voicePrivateMB - base.voicePrivateMB) / w.people : null,
    voiceDownKBps: (w.voiceDownPerS || 0) / w.people / 1024,
    voiceUpKBps: (w.voiceUpPerS || 0) / w.people / 1024
  };
}

function fixed(x, n) { return typeof x === 'number' && isFinite(x) ? x.toFixed(n) : ''; }

function markdown(doc) {
  const out = [];
  out.push('### Load test, ' + doc.shape + ' (' + doc.started + ')');
  out.push('');
  out.push('Engine ' + doc.engine + ', gamemode git blob ' + doc.blob.slice(0, 12) + ', ' + doc.cores + ' cores on ' + (doc.cpuModel || 'the machine') + '. ' +
    'Each bot logs in over the game port and walks, a move every 130 ms. Bytes are on the wire, IPv4 and UDP headers included.');
  out.push('');
  out.push('Memory is the server process\'s private bytes; its working set, which Windows trims, is in result.json.');
  out.push('');
  out.push('| People | Server cores | Server memory MB | Down KB/s | Up KB/s | Per person: cores | MB | down KB/s | up KB/s | Moves read per bot /s | Runner busy |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const st of doc.steps) {
    const w = st.window; const p = st.perPerson || {};
    if (!w) { out.push('| ' + st.people + ' | not measured: ' + st.stopped + ' |||||||||| '); continue; }
    out.push('| ' + [w.people, fixed(w.serverCores, 3), fixed(w.serverPrivateMB === null || w.serverPrivateMB === undefined ? w.serverRssMB : w.serverPrivateMB, 0), fixed(w.downWirePerS / 1024, 1), fixed(w.upWirePerS / 1024, 1),
      fixed(p.cores, 4), fixed(p.memoryMB, 2), fixed(p.downKBps, 2), fixed(p.upKBps, 2), fixed(w.movesReadPerBotPerS, 1),
      fixed(w.machineBusy * 100, 0) + '%'].join(' | ') + ' |');
  }
  out.push('');
  out.push('The voice service, which carries each person\'s chat socket and join pass (bytes are the socket\'s text, without TCP\'s own):');
  out.push('');
  out.push('| People | Voice cores | Voice memory MB | Per person: cores | MB | down KB/s | up KB/s |');
  out.push('|---|---|---|---|---|---|---|');
  for (const st of doc.steps) {
    const w = st.window; const p = st.perPerson || {};
    if (!w) { continue; }
    out.push('| ' + [w.people, fixed(w.voiceCores, 3), fixed(w.voicePrivateMB, 0), fixed(p.voiceCores, 4), fixed(p.voiceMemoryMB, 2),
      fixed(p.voiceDownKBps, 2), fixed(p.voiceUpKBps, 3)].join(' | ') + ' |');
  }
  out.push('');
  if (doc.play && doc.play.length) {
    out.push('What the bots did besides walking (' + doc.play.join(', ') + '), counted over each window:');
    out.push('');
    for (const st of doc.steps) { if (st.window) { out.push('- ' + st.people + ' people: ' + JSON.stringify(st.play || {})); } }
    out.push('');
  }
  for (const st of doc.steps) { if (st.stopped) { out.push('Stopped at ' + st.people + ': ' + st.stopped); } }
  if (doc.problem) { out.push('Problem: ' + doc.problem); }
  return out.join('\n') + '\n';
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)$/.exec(argv[i]);
    if (!m || i + 1 >= argv.length) { throw new Error('what is "' + argv[i] + '"? Use --root, --out, --steps, --settle, --hold, --workers, --shape, --summary, --play, --busy and --watch.'); }
    o[m[1]] = argv[++i];
  }
  return o;
}

// A child process with IPC, and a way to ask it something and wait for the
// answer it sends back under the same key.
function child(file, argv, log) {
  const c = childProcess.fork(file, argv, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const waiting = [];
  c.on('message', (m) => {
    for (let i = 0; i < waiting.length; i++) {
      if (m && m[waiting[i].key] !== undefined) { const w = waiting.splice(i, 1)[0]; w.done(m[w.key]); return; }
    }
  });
  c.stdout.on('data', (d) => log(path.basename(file) + ': ' + String(d).trim()));
  c.stderr.on('data', (d) => log(path.basename(file) + ': ' + String(d).trim()));
  c.ask = (msg, key, ms) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(path.basename(file) + ' gave no ' + key + ' in ' + ms / 1000 + ' s')), ms);
    waiting.push({ key, done: (v) => { clearTimeout(t); resolve(v); } });
    if (msg) { c.send(msg); }
  });
  return c;
}

// What the bots do besides walking (load-bots.js --play): fight, host the
// NPCs the server hands them, and open the guild traders near them.
const PLAYS = ['fight', 'host', 'trade'];

// The play counts the bots reported over the window, added up.
function playCounts(reports) {
  const out = {};
  for (const r of reports) { for (const k of Object.keys(r.play || {})) { out[k] = (out[k] || 0) + r.play[k]; } }
  return out;
}

// On the box, the servers people are on: each url is an online.json, and
// anybody on it stops the run, so a load copy never shares the box's cores
// with a person. One that does not answer stops it too: nobody can say it
// is empty.
function someoneOn(urls) {
  return Promise.all(urls.map((u) => new Promise((resolve) => {
    const req = http.get(u, { timeout: 10000 }, (res) => {
      let t = '';
      res.on('data', (d) => { t += d; });
      res.on('end', () => {
        let n = NaN;
        try { n = Number(JSON.parse(t).now); } catch (e) { n = NaN; }
        if (!(n >= 0)) { resolve(u + ' answered no count of people (HTTP ' + res.statusCode + ')'); return; }
        resolve(n > 0 ? n + ' ' + (n === 1 ? 'person is' : 'people are') + ' on ' + u + ', so the run stopped' : '');
      });
    });
    req.on('timeout', () => { req.destroy(new Error('no answer in 10 s')); });
    req.on('error', (e) => resolve(u + ' could not be read (' + e.message + '), so nobody can say it is empty'));
  }))).then((rs) => rs.filter(Boolean).join('; '));
}

// The gamemode's own lines about the NPCs, merchants, quests and the load
// order, from the server's log, so a run says whether they started.
function gameLines(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return ['the server log could not be read: ' + e.message]; }
  return text.split(/\r?\n/).filter((l) => /npc|merchant|quest|load order|loadorder/i.test(l)).slice(0, 60).map((l) => l.slice(0, 300));
}

async function run(o) {
  const root = path.resolve(o.root);
  const log = o.log || ((s) => console.log(s));
  const steps = String(o.steps || '10,20,40,60,80,100').split(',').map(Number).filter((n) => n > 0);
  const settleMs = (Number(o.settle) || 20) * 1000;
  const holdMs = (Number(o.hold) || 60) * 1000;
  const workerCount = Math.max(1, Number(o.workers) || 3);
  const busyLimit = Number(o.busy) > 0 && Number(o.busy) < 1 ? Number(o.busy) : BUSY;
  const play = String(o.play || '').split(',').filter(Boolean);
  for (const p of play) { if (!PLAYS.includes(p)) { return { schema: 1, problem: '--play takes ' + PLAYS.join(', ') + ', not ' + p, steps: [] }; } }
  const watch = String(o.watch || '').split(',').filter(Boolean);
  const settings = readJson(path.join(root, 'server-settings.json'));
  const port = Number(settings.port);
  const password = settings.password === undefined ? '' : String(settings.password);
  const blob = gitBlob(path.join(root, 'gamemode.js'));
  let engine = '';
  try { engine = String(readJson(path.join(root, 'server-build.json')).source.commit || ''); } catch (e) { engine = 'not named (no server-build.json beside it)'; }
  const doc = { schema: 1, shape: o.shape || 'crowd', started: new Date().toISOString(), engine, blob, cores: os.cpus().length,
    cpuModel: (os.cpus()[0] || {}).model || '', totalMemMB: Math.round(os.totalmem() / 1048576), settleS: settleMs / 1000, holdS: holdMs / 1000,
    baseline: null, steps: [], problem: '', tail: [], play, busyLimit, watched: watch, gameLines: [] };
  if (!(port > 0)) { doc.problem = 'server-settings.json names no port'; return doc; }
  try { passKeyOf(root); } catch (e) { doc.problem = 'the bots cannot hold join passes here: ' + e.message; return doc; }
  if (Number(settings.maxPlayers) < Math.max(...steps)) { doc.problem = 'maxPlayers is ' + settings.maxPlayers + ', fewer than the ' + Math.max(...steps) + ' bots asked for'; return doc; }

  const sampleFile = path.join(root, 'load-samples.jsonl');
  try { fs.unlinkSync(sampleFile); } catch (e) { if (e.code !== 'ENOENT') { throw e; } }
  const sampler = path.join(__dirname, 'load-sampler.js');
  const server = new ServerRun(root, (r) => childProcess.spawn(process.execPath, ['-r', sampler, 'dist_back/skymp5-server.js'], {
    cwd: r, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: Object.assign({}, process.env, { THORNSWOOD_LOAD_SAMPLES: sampleFile })
  }), path.join(root, 'load-test-server.log'));
  let proxy = null;
  let voice = null;
  let site = null;
  const workers = [];
  const voicePort = Number(settings.thornswoodVoicePort) || 0;
  const voiceSamples = path.join(root, 'voice-samples.jsonl');
  try {
    if (voicePort) {
      site = await siteThatSaysYes();
      voice = await startVoice(root, voicePort, site.url, sampler, voiceSamples, log);
      log('the voice service listens on 127.0.0.1:' + voicePort);
    }
    const onBefore = await someoneOn(watch);
    if (onBefore) { doc.problem = onBefore; return doc; }
    server.start();
    const why = await server.awaitLoad(blob, 600000);
    if (why) { doc.problem = why; return doc; }
    log('the server loaded gamemode.js, git blob ' + blob.slice(0, 12));

    proxy = child(path.join(__dirname, 'load-proxy.js'), ['--target', '127.0.0.1:' + port], log);
    const proxyPort = await proxy.ask(null, 'listening', 10000);
    for (let i = 0; i < workerCount; i++) {
      workers.push(child(path.join(__dirname, 'load-bots.js'), ['--root', root, '--port', String(proxyPort), '--password', password, '--voice', String(voicePort)].concat(play.length ? ['--play', play.join(',')] : []), log));
    }

    const reading = async () => {
      const ss = samples(sampleFile);
      if (!ss.length) { throw new Error('the server wrote no samples to ' + sampleFile); }
      return { at: Date.now(), server: ss[ss.length - 1], proxy: await proxy.ask({ report: true }, 'report', 10000), cpu: machineCpu(),
        memory: processMemory(server.child && server.child.pid),
        voice: voice ? (samples(voiceSamples).slice(-1)[0] || null) : null,
        voiceMemory: voice ? processMemory(voice.pid) : null };
    };
    const botReports = () => Promise.all(workers.map((w) => w.ask({ report: true }, 'report', 10000)));
    // A window: settle, then read, wait, read. The server's samples come
    // once a second, so its cores are taken over the samples' own times,
    // not the reads'.
    const measure = async (people) => {
      await sleep(settleMs);
      await botReports();
      const a = await reading();
      await sleep(holdMs);
      const b = await reading();
      const bots = await botReports();
      return { window: windowOf(a, b, bots, people), bots };
    };

    log('step 0: the server with nobody on it');
    const base = await measure(0);
    doc.baseline = base.window;
    log('  server ' + fixed(base.window.serverCores, 3) + ' cores, ' + fixed(base.window.serverPrivateMB, 0) + ' MB private, ' + fixed(base.window.serverRssMB, 0) + ' MB working set');

    let next = 1900000000 + Math.floor(Math.random() * 1000000) * 10;
    let have = 0;
    for (const people of steps) {
      const step = { people, window: null, perPerson: null, stopped: '', failed: [], teleports: 0, counts: {} };
      doc.steps.push(step);
      const on = await someoneOn(watch);
      if (on) { step.stopped = on; log('  stopped: ' + on); break; }
      log('step ' + people + ': adding ' + (people - have) + ' bots');
      for (let k = have; k < people; k++) {
        workers[k % workers.length].send({ add: [next++] });
        if ((k - have + 1) % RAMP_PER_S === 0) { await sleep(1000); }
      }
      have = people;
      const fillEnd = Date.now() + FILL_MS;
      let reps = [];
      for (;;) {
        if (server.exited) { step.stopped = 'the server ended: ' + JSON.stringify(server.exited); break; }
        if (voice && voice.exitCode !== null) { step.stopped = 'the voice service ended with exit ' + voice.exitCode; break; }
        reps = await botReports();
        const moving = reps.reduce((x, r) => x + (r.steps.moving || 0), 0);
        const failed = [].concat(...reps.map((r) => r.failed));
        if (failed.length) { step.failed = failed; step.stopped = failed.length + ' of the bots could not get in or were dropped; the first: ' + failed[0].why; break; }
        const inVoice = reps.reduce((x, r) => x + (r.inVoice || 0), 0);
        if (moving >= people && (!voicePort || inVoice >= people)) { break; }
        if (Date.now() > fillEnd) { step.stopped = 'only ' + moving + ' of ' + people + ' bots were walking after ' + FILL_MS / 1000 + ' s: ' + JSON.stringify(reps.map((r) => r.steps)); break; }
        await sleep(1000);
      }
      if (step.stopped) { log('  stopped: ' + step.stopped); break; }
      const m = await measure(people);
      if (server.exited) { step.stopped = 'the server ended during the window: ' + JSON.stringify(server.exited); log('  stopped: ' + step.stopped); break; }
      const failed = [].concat(...m.bots.map((r) => r.failed));
      step.window = m.window;
      step.perPerson = perPerson(m.window, base.window);
      step.teleports = m.bots.reduce((x, r) => x + r.teleports, 0);
      for (const r of m.bots) { for (const k of Object.keys(r.counts)) { step.counts[k] = (step.counts[k] || 0) + r.counts[k]; } }
      const w = m.window;
      log('  server ' + fixed(w.serverCores, 3) + ' cores, ' + fixed(w.serverPrivateMB, 0) + ' MB private, ' + fixed(w.serverRssMB, 0) + ' MB working set, down ' + fixed(w.downWirePerS / 1024, 1) +
        ' KB/s, up ' + fixed(w.upWirePerS / 1024, 1) + ' KB/s, each bot read ' + fixed(w.movesReadPerBotPerS, 1) +
        ' moves a second, runner ' + fixed(w.machineBusy * 100, 0) + '% busy');
      if (failed.length) { step.failed = failed; step.stopped = failed.length + ' bots were dropped during the window; the first: ' + failed[0].why; break; }
      step.play = playCounts(m.bots);
      if (w.machineBusy >= busyLimit) { step.stopped = 'the machine was ' + fixed(w.machineBusy * 100, 0) + '% busy, past the ' + fixed(busyLimit * 100, 0) + '% this run stops at'; break; }
      const onAfter = await someoneOn(watch);
      if (onAfter) { step.stopped = onAfter; log('  stopped: ' + onAfter); break; }
    }
    return doc;
  } catch (e) {
    doc.problem = 'the load test itself failed: ' + (e && e.stack || e);
    return doc;
  } finally {
    for (const w of workers) { try { w.send({ stop: true }); } catch (e) { log('a bot process had ended already: ' + e.message); } }
    if (proxy) { try { proxy.send({ stop: true }); } catch (e) { log('the proxy had ended already: ' + e.message); } }
    await server.stop(60000);
    if (voice) { voice.kill(); }
    if (site) { site.server.close(); }
    doc.tail = server.tail.slice(-30);
    doc.gameLines = gameLines(path.join(root, 'load-test-server.log'));
    doc.ended = new Date().toISOString();
  }
}

async function main() {
  const o = args(process.argv.slice(2));
  if (!o.root || !o.out) {
    console.log('node Load-Test.js --root <server folder> --out <result.json> [--steps 10,20,40,60,80,100] [--settle 20] [--hold 60] [--workers 3] [--shape crowd] [--summary <file>]');
    return 2;
  }
  const doc = await run(o);
  fs.writeFileSync(o.out, JSON.stringify(doc, null, 2));
  const md = markdown(doc);
  if (o.summary) { fs.appendFileSync(o.summary, md); }
  console.log(md);
  const ok = !doc.problem && doc.baseline && doc.steps.some((s) => s.window);
  console.log(ok ? 'LOAD TEST MEASURED' : 'LOAD TEST FAILED: ' + (doc.problem || 'no step was measured'));
  if (!ok) { console.log(doc.tail.join('\n')); }
  return ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (e) => { console.log('LOAD TEST FAILED: ' + (e && e.stack || e)); process.exit(1); });
}

module.exports = { windowOf, perPerson, markdown, samples, run, startVoice, siteThatSaysYes, someoneOn, playCounts, gameLines, PLAYS };
