// scripts/bot/load-proxy.js
//
// #4623. The load test's byte counter. Every bot connects to this instead of
// the game server, and this passes each datagram on unchanged, both ways,
// counting it. Each bot gets a socket of its own towards the server, so the
// server sees one address per bot exactly as it sees one per game. The bot
// client exposes no byte counts of its own and loopback traffic shows in no
// interface counter, so this is where the bandwidth of a person is read:
// every byte of SLikeNet's own, its acknowledgements and resends included.
// On the wire each datagram also carries 28 bytes of IPv4 and UDP header,
// which the load test adds per datagram.
//
// ONE ADDRESS A BOT, AS ONE A PERSON. Each bot's socket towards the server is
// bound to a loopback address of its own, 127.0.1.1, 127.0.1.2 and on (all
// of 127.0.0.0/8 is loopback on Windows and Linux alike), because people
// come from addresses of their own. The engine turns on SLikeNet's limit on
// how often one address may connect (SetLimitIPConnectionFrequency,
// Networking.cpp), which refuses a second connection from an address within
// 100 ms of the first, and it holds for 127.0.0.1: measured on the first
// runs of the load test (run 41352899299), 2 of 5 bots that connected from
// 127.0.0.1 in the same second were refused with "IP recently connected".
//
// Run by Load-Test.js as a child with IPC:
//   node load-proxy.js --target 127.0.0.1:<port>
// It sends { listening: <port> } once it listens, answers
// { report: true } with { report: { clients, up, upDatagrams, down,
// downDatagrams } } (up is bots to the server), and ends on { stop: true }.
'use strict';
const dgram = require('dgram');

// The loopback address of the n-th bot, from 0: 127.0.1.1 to 127.0.1.250,
// then 127.0.2.1 and on.
function addressFor(n) {
  return '127.0.' + (1 + Math.floor(n / 250)) + '.' + (1 + (n % 250));
}

function makeProxy(targetHost, targetPort, onReady) {
  const front = dgram.createSocket('udp4');
  let made = 0;
  const clients = new Map();  // "address:port" of a bot -> { back, up, upD, down, downD }
  const totals = { up: 0, upDatagrams: 0, down: 0, downDatagrams: 0 };
  const problems = [];

  front.on('message', (buf, from) => {
    const key = from.address + ':' + from.port;
    let c = clients.get(key);
    if (!c) {
      const back = dgram.createSocket('udp4');
      const address = addressFor(made++);
      c = { back, address, ready: false, queue: [] };
      clients.set(key, c);
      back.on('message', (reply) => {
        totals.down += reply.length; totals.downDatagrams++;
        front.send(reply, from.port, from.address);
      });
      back.on('error', (e) => { problems.push('the socket towards the server for ' + key + ': ' + e.message); });
      back.bind(0, address, () => {
        back.connect(targetPort, targetHost, () => {
          c.ready = true;
          for (const q of c.queue) { back.send(q); }
          c.queue = [];
        });
      });
    }
    totals.up += buf.length; totals.upDatagrams++;
    if (c.ready) { c.back.send(buf); } else { c.queue.push(buf); }
  });
  front.on('error', (e) => { problems.push('the socket the bots connect to: ' + e.message); });
  front.bind(0, '127.0.0.1', () => onReady(front.address().port));

  return {
    report: () => Object.assign({ clients: clients.size, problems: problems.slice() }, totals),
    close: () => {
      for (const c of clients.values()) { c.back.close(); }
      front.close();
    }
  };
}

function main() {
  const i = process.argv.indexOf('--target');
  const target = i >= 0 ? String(process.argv[i + 1] || '') : '';
  const m = /^([^:]+):(\d+)$/.exec(target);
  if (!m || !process.send) {
    console.log('node load-proxy.js --target <host>:<port>, started by Load-Test.js with IPC');
    process.exit(2);
  }
  const proxy = makeProxy(m[1], Number(m[2]), (port) => process.send({ listening: port }));
  process.on('message', (msg) => {
    if (msg && msg.report) { process.send({ report: proxy.report() }); }
    if (msg && msg.stop) { proxy.close(); process.exit(0); }
  });
  process.on('disconnect', () => { proxy.close(); process.exit(0); });
}

if (require.main === module) { main(); }

module.exports = { makeProxy, addressFor };
