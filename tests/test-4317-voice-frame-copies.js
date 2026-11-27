'use strict';
/*
  test-4317-voice-frame-copies.js

      node tests/test-4317-voice-frame-copies.js

  #4317. The voice service's Sock.feed joined each read onto everything it
  already held of a frame (Buffer.concat) until the frame was whole, so a large
  frame arriving in small reads was copied again on every read: the bytes
  copied grew with the square of the frame's size, on the one thread that
  relays chat, positions and signalling. Measured on the box: a 999,000 byte
  frame in 1460 byte reads cost 145 ms and 343 MB copied.

  The service's own socket code is read out of voice/voice-server.js and run
  here on its own, with no network: one chat frame at a time is fed in 1460
  byte reads, as TCP hands them over, and every byte Buffer.concat and
  Buffer#copy move is counted.

    1. each frame still arrives whole and exactly once, with a ping and a
       second frame behind it in the same read, and its header split across
       reads;
    2. the bytes copied for one frame are at most twice its size, at every
       size up to the 999,000 bytes of the measurement;
    3. four times the frame is at most about four times the copying, not
       sixteen.

  Nothing leaves this machine.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const source = fs.readFileSync(path.join(__dirname, '..', 'voice', 'voice-server.js'), 'utf8');
const firstClass = ['class FrameInput {', 'class Sock {']
  .map((s) => source.indexOf(s)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
const end = source.indexOf('// ------------------------------------------------------------- signalling --');
if (firstClass === undefined || end < firstClass) throw new Error('cannot find Sock in voice/voice-server.js');
const Sock = vm.runInNewContext(source.slice(firstClass, end) + '\nSock', { Buffer, performance, live: new Set() });
const fresh = new Sock({ on() {} });            // as the service makes one, for its input buffer
const startBuf = fresh.buf;

// A client frame as a browser sends it: FIN, masked, the length in the
// shortest form RFC 6455 allows.
function frame(op, data) {
  const ext = data.length > 65535 ? 8 : data.length > 125 ? 2 : 0;
  const out = Buffer.alloc(2 + ext + 4 + data.length);
  out[0] = 0x80 | op;
  out[1] = 0x80 | (ext === 8 ? 127 : ext === 2 ? 126 : data.length);
  if (ext === 2) out.writeUInt16BE(data.length, 2);
  if (ext === 8) out.writeBigUInt64BE(BigInt(data.length), 2);
  const mask = [0x5a, 0x13, 0xc7, 0x81];
  out.set(mask, 2 + ext);
  for (let i = 0; i < data.length; i++) out[6 + ext + i] = data[i] ^ mask[i & 3];
  return out;
}
const chat = (text) => frame(1, Buffer.from(JSON.stringify({ t: 'chat', text })));

function socket() {
  const s = Object.create(Sock.prototype);
  s.buf = startBuf.constructor === Buffer ? Buffer.alloc(0) : new startBuf.constructor();
  s.rxBytes = 0; s.closed = false; s.backed = false;
  s.seen = []; s.pongs = [];
  s.onmessage = (m) => s.seen.push(m.text);
  s.write = (b) => s.pongs.push(Buffer.from(b));
  s.socket = { write() {} };
  s.close = (why) => { s.closed = why; };
  return s;
}

// Every byte the two copying calls move while fn runs.
function copiedBy(fn) {
  let copied = 0;
  const concat = Buffer.concat, copy = Buffer.prototype.copy;
  Buffer.concat = function (list, size) {
    copied += size === undefined ? list.reduce((t, b) => t + b.length, 0) : size;
    return concat.call(this, list, size);
  };
  Buffer.prototype.copy = function (...args) {
    const n = copy.apply(this, args);
    copied += n;
    return n;
  };
  try { fn(); } finally { Buffer.concat = concat; Buffer.prototype.copy = copy; }
  return copied;
}

function reads(bytes, size) {
  const out = [];
  for (let at = 0; at < bytes.length; at += size) out.push(bytes.subarray(at, at + size));
  return out;
}

// ----------------------------------------------------------- 1. whole --
{
  const text = 'A note for the ferry keeper. '.repeat(3000);   // 87,000 bytes: a 64-bit length
  const big = chat(text), ping = frame(9, Buffer.from('ok')), after = chat('Good evening.');
  const s = socket();
  const pieces = [big.subarray(0, 1), big.subarray(1, 5)].concat(reads(big.subarray(5, big.length - 9), 1460));
  pieces.push(Buffer.concat([big.subarray(big.length - 9), ping, after]));
  for (const p of pieces.slice(0, -1)) s.feed(p);
  yes('1a nothing is said before the frame is whole', s.seen.length === 0 && !s.closed);
  s.feed(pieces[pieces.length - 1]);
  yes('1b the large frame and the one behind it arrive whole, once, in order',
      s.seen.length === 2 && s.seen[0] === text && s.seen[1] === 'Good evening.');
  yes('1c the ping in the same read is answered with its own bytes',
      s.pongs.length === 1 && s.pongs[0].toString('hex') === '8a026f6b');
  yes('1d every byte is counted as received', s.rxBytes === big.length + ping.length + after.length);
}

// ----------------------------------------------------------- 2. linear --
const costs = {};
for (const size of [62500, 250000, 999000]) {
  const f = chat('x'.repeat(size - 22));            // the frame's payload is size bytes
  const s = socket();
  const copied = copiedBy(() => { for (const p of reads(f, 1460)) s.feed(p); });
  costs[size] = copied;
  yes('2 a ' + size + ' byte frame in 1460 byte reads copies at most twice its size (' +
      (copied / 1048576).toFixed(1) + ' MB copied)',
      s.seen.length === 1 && s.seen[0].length === size - 22 && copied <= 2 * f.length);
}

// ------------------------------------------------------------ 3. growth --
const growth = costs[250000] / costs[62500];
yes('3 four times the frame costs about four times the copying, not sixteen (' + growth.toFixed(1) + ' times)',
    growth < 6);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
