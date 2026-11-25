/*
  box-forwarder.js

      npm install --prefix <a scratch folder> node-datachannel@0.33.4
      NODE_PATH=<that folder>/node_modules node docs/studies/in-game-ui/measure/box-forwarder.js [listener counts...]

  #3208. The other half of the voice question: what it costs the box to carry
  every voice itself and send it only to the people in range, instead of
  every launcher sending its microphone to everybody in the room
  (voice-mesh.js measures that).

  Three processes, so each one's processor time is its own:

    box        one WebRTC connection per person (libdatachannel, through
               node-datachannel, the library a native launcher would use too).
               Every RTP packet that comes in from the talker is copied to
               each listener's connection with that connection's own SSRC
               written in, the whole of what a forwarder does per packet.
               Nothing is decoded or mixed.
    talker     one connection, sending one Opus-sized RTP packet every 20 ms
               (80 bytes of payload, which is 32 kbit/s, Chromium's default
               for a voice), as a native client in the launcher would.
    listeners  N connections that count what arrives.

  For each listener count it reads the box's and the talker's processor time
  over a fixed window, and checks that every listener got the packets. The
  packets are not real Opus: the forwarder never looks inside one, so the
  bytes are what matter. Loopback only; nothing outside this process tree.
*/
'use strict';
const { fork } = require('child_process');
const ndc = require('node-datachannel');

const ROLE = ['box', 'talker', 'listeners'].indexOf(process.argv[2]) >= 0 ? process.argv[2] : '';
const WINDOW_MS = Number(process.env.WINDOW_MS || 15000);
const PT = 111;
const PAYLOAD = 80;

function connection(name, ssrc, onSignal, onPacket) {
  const pc = new ndc.PeerConnection(name, { iceServers: [] });
  const audio = new ndc.Audio('a', 'SendRecv');
  audio.addOpusCodec(PT);
  audio.addSSRC(ssrc, 'c' + ssrc, 's' + ssrc, 't' + ssrc);
  const track = pc.addTrack(audio);
  track.onMessage((buf) => onPacket && onPacket(buf));
  pc.onLocalDescription((sdp, type) => onSignal({ k: 'sdp', sdp, type }));
  pc.onLocalCandidate((cand, mid) => onSignal({ k: 'ice', cand, mid }));
  return { pc, track, ssrc, open: () => track.isOpen() };
}

function signalInto(c, m) {
  if (m.k === 'sdp') c.pc.setRemoteDescription(m.sdp, m.type);
  else c.pc.addRemoteCandidate(m.cand, m.mid);
}

// ------------------------------------------------------------------ box --
if (ROLE === 'box') {
  const conns = {};
  let talker = null;
  const listeners = [];
  let forwarded = 0;
  process.on('message', (m) => {
    if (m.t === 'open') {
      const c = connection('box-' + m.id, 1000 + m.id, (s) => process.send({ t: 'sig', to: m.id, s }), m.id === 0 ? (buf) => {
        // The forwarder's whole job: the same packet to each listener in
        // range, under that listener's SSRC.
        for (const l of listeners) {
          const out = Buffer.from(buf);
          out.writeUInt32BE(l.ssrc, 8);
          l.track.sendMessageBinary(out);
          forwarded++;
        }
      } : null);
      conns[m.id] = c;
      if (m.id === 0) talker = c; else listeners.push(c);
      c.pc.setLocalDescription();
    } else if (m.t === 'sig') {
      signalInto(conns[m.from], m.s);
    } else if (m.t === 'ready?') {
      const all = Object.values(conns);
      process.send({ t: 'ready', open: all.filter((c) => c.open()).length, of: all.length });
    } else if (m.t === 'cpu') {
      process.send({ t: 'cpu', cpu: process.cpuUsage(), at: Date.now(), forwarded });
    } else if (m.t === 'bye') {
      for (const c of Object.values(conns)) c.pc.close();
      ndc.cleanup();
      // Letting go of the channel to the run ends this child, as nothing
      // else holds it open (#6036).
      process.disconnect();
    }
  });
}

// ------------------------------------------------ talker and listeners --
if (ROLE === 'talker' || ROLE === 'listeners') {
  const conns = {};
  const got = {};
  let timer = null;
  process.on('message', (m) => {
    if (m.t === 'open') {
      const c = connection(ROLE + '-' + m.id, 5000 + m.id, (s) => process.send({ t: 'sig', from: m.id, s }),
        (buf) => { got[m.id] = (got[m.id] || 0) + 1; });
      conns[m.id] = c;
    } else if (m.t === 'sig') {
      signalInto(conns[m.to], m.s);
    } else if (m.t === 'talk') {
      const c = conns[0];
      let seq = 0, ts = 0;
      timer = setInterval(() => {
        if (!c.open()) return;
        const p = Buffer.alloc(12 + PAYLOAD);
        p[0] = 0x80; p[1] = PT;
        p.writeUInt16BE(seq++ & 0xffff, 2);
        p.writeUInt32BE(ts >>> 0, 4); ts += 960;
        p.writeUInt32BE(c.ssrc, 8);
        for (let i = 12; i < p.length; i++) p[i] = (Math.random() * 256) | 0;
        c.track.sendMessageBinary(p);
      }, 20);
    } else if (m.t === 'cpu') {
      const total = Object.values(got).reduce((a, b) => a + b, 0);
      process.send({ t: 'cpu', cpu: process.cpuUsage(), at: Date.now(), got: total, gotBy: Object.keys(got).length });
    } else if (m.t === 'bye') {
      if (timer) clearInterval(timer);
      for (const c of Object.values(conns)) c.pc.close();
      ndc.cleanup();
      // Letting go of the channel to the run ends this child, as nothing
      // else holds it open (#6036).
      process.disconnect();
    }
  });
}

// ------------------------------------------------------------- the run --
if (!ROLE) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ask = (child, t) => new Promise((ok) => {
    const on = (m) => { if (m.t === t.reply) { child.removeListener('message', on); ok(m); } };
    child.on('message', on);
    child.send({ t: t.ask });
  });
  const sizes = process.argv.slice(2).map(Number).filter((n) => n >= 1);
  const kids = [];
  (async () => {
    const rows = [];
    for (const n of (sizes.length ? sizes : [10, 50, 100, 200])) {
      const box = fork(__filename, ['box']);
      const talker = fork(__filename, ['talker']);
      const ls = fork(__filename, ['listeners']);
      kids.push(box, talker, ls);
      const side = (id) => (id === 0 ? talker : ls);
      box.on('message', (m) => { if (m.t === 'sig') side(m.to).send({ t: 'sig', to: m.to, s: m.s }); });
      for (const c of [talker, ls]) c.on('message', (m) => { if (m.t === 'sig') box.send({ t: 'sig', from: m.from, s: m.s }); });
      for (let id = 0; id <= n; id++) { side(id).send({ t: 'open', id }); box.send({ t: 'open', id }); }
      const from = Date.now();
      let r;
      while ((r = await ask(box, { ask: 'ready?', reply: 'ready' })).open < n + 1 && Date.now() - from < 60000) await sleep(300);
      talker.send({ t: 'talk' });
      await sleep(3000);
      const b0 = await ask(box, { ask: 'cpu', reply: 'cpu' }), t0 = await ask(talker, { ask: 'cpu', reply: 'cpu' }), l0 = await ask(ls, { ask: 'cpu', reply: 'cpu' });
      await sleep(WINDOW_MS);
      const b1 = await ask(box, { ask: 'cpu', reply: 'cpu' }), t1 = await ask(talker, { ask: 'cpu', reply: 'cpu' }), l1 = await ask(ls, { ask: 'cpu', reply: 'cpu' });
      const secs = (b1.at - b0.at) / 1000;
      const pct = (a, b) => Math.round(((b.cpu.user + b.cpu.system) - (a.cpu.user + a.cpu.system)) / 1e6 / secs * 1000) / 10;
      const row = {
        listeners: n, open: r.open + ' of ' + (n + 1),
        boxCpuPct: pct(b0, b1), talkerCpuPct: pct(t0, t1),
        forwardedPerSec: Math.round((b1.forwarded - b0.forwarded) / secs),
        receivedPerSec: Math.round((l1.got - l0.got) / secs), listenersHearing: l1.gotBy,
        boxOutKbit: Math.round((b1.forwarded - b0.forwarded) / secs * (12 + PAYLOAD + 10 + 28) * 8 / 100) / 10,
      };
      console.log(JSON.stringify(row));
      rows.push(row);
      for (const c of [box, talker, ls]) c.send({ t: 'bye' });
      await sleep(1500);
    }
    console.log('\n| Listeners in range | Connections open | Box CPU % | Talker CPU % | Packets forwarded/s | Packets received/s | Box upload kbit/s |');
    console.log('|---|---|---|---|---|---|---|');
    for (const r of rows) {
      console.log('| ' + r.listeners + ' | ' + r.open + ' | ' + r.boxCpuPct + ' | ' + r.talkerCpuPct + ' | ' + r.forwardedPerSec +
        ' | ' + r.receivedPerSec + ' | ' + r.boxOutKbit + ' |');
    }
  })().catch((e) => {
    console.error(e);
    process.exitCode = 1;
    for (const k of kids) { if (k.exitCode === null && k.signalCode === null) k.kill(); }
  });
}
