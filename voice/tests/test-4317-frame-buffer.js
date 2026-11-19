'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../voice-server.js'), 'utf8');
const start = source.indexOf('class FrameInput {');
const end = source.indexOf('// ------------------------------------------------------------- signalling --');
const {Sock, FrameInput} = vm.runInNewContext(source.slice(start < 0 ? source.indexOf('class Sock {') : start, end) +
  '\n({Sock, FrameInput: typeof FrameInput === "undefined" ? null : FrameInput})',
  {Buffer, performance});

function frame(text, op = 1) {
  const data = Buffer.from(text);
  const ext = data.length > 125 ? 2 : 0;
  const buf = Buffer.alloc(6 + ext + data.length);
  buf[0] = 0x80 | op;
  buf[1] = 0x80 | (ext ? 126 : data.length);
  if (ext) buf.writeUInt16BE(data.length, 2);
  const mask = [10, 20, 30, 40];
  buf.set(mask, 2 + ext);
  for (let i = 0; i < data.length; i++) buf[6 + ext + i] = data[i] ^ mask[i & 3];
  return buf;
}

const text = 'A note for the ferry keeper. '.repeat(12);
const first = frame(JSON.stringify({t:'note', text}));
const ping = frame('ok', 9);
const second = frame(JSON.stringify({t:'note', text:'Good evening.'}));
const chunks = [first.subarray(0, 1), first.subarray(1, 3)];
for (let off = 3; off < first.length - 12; off += 21) {
  chunks.push(first.subarray(off, Math.min(off + 21, first.length - 12)));
}
chunks.push(Buffer.concat([first.subarray(-12), ping, second]));
const seen = [], replies = [];
const sock = Object.create(Sock.prototype);
sock.buf = FrameInput ? new FrameInput() : Buffer.alloc(0);
sock.rxBytes = 0;
sock.onmessage = msg => seen.push(msg.text);
sock.write = bytes => replies.push(bytes.toString('hex'));
sock.close = reason => { throw new Error(reason); };
let copied = 0;
const concat = Buffer.concat, copy = Buffer.prototype.copy;
Buffer.concat = function (parts, size) {
  copied += size ?? parts.reduce((total, part) => total + part.length, 0);
  return concat.call(this, parts, size);
};
Buffer.prototype.copy = function (...args) {
  const count = copy.apply(this, args);
  copied += count;
  return count;
};
try {
  for (const chunk of chunks.slice(0, -1)) sock.feed(chunk);
  assert.equal(seen.length, 0);
  sock.feed(chunks.at(-1));
} finally {
  Buffer.concat = concat;
  Buffer.prototype.copy = copy;
}
assert.deepEqual(seen, [text, 'Good evening.']);
assert.deepEqual(replies, ['8a026f6b']);
const input = first.length + second.length + ping.length;
assert.equal(sock.rxBytes, input);
assert.ok(copied <= 3 * input, `copied ${copied} bytes for ${input} input bytes`);
console.log(`PASS parsed split and adjacent frames; copied ${copied} bytes for ${input} input bytes`);
