'use strict';
// Real loopback ICE/DTLS, with the actual receive thread parked at the
// local-close race. No public service, credentials, audio device or STUN.
const fs = require('fs'), os = require('os'), path = require('path');
const lc = require('./launcher-csc');
const root = path.join(__dirname, '..');
const names = ['VoiceSession', 'VoiceLoop', 'VoiceStun', 'VoiceMix', 'VoiceMeter', 'VoiceHrtf', 'Failure', 'Swallow'];
const files = names.map(n => path.join(root, 'launcher', 'app', n + '.cs'));
files.push(path.join(__dirname, 'voice-launcher', 'StandIns.cs'), path.join(__dirname, 'voice-dtls-shutdown', 'DtlsShutdownCases.cs'));
let ice = fs.readFileSync(path.join(root, 'launcher', 'app', 'VoiceIce.cs'), 'utf8');
const binding = 'bound = DefaultLocal();';
if (ice.split(binding).length !== 2) throw new Error('Cannot guarantee loopback-only fixture binding');
let peer = fs.readFileSync(path.join(root, 'launcher', 'app', 'VoicePeer.cs'), 'utf8');
const receive = 'tr.Receive(buf, 0, buf.Length, 1000);';
if (peer.split(receive).length !== 2) throw new Error('Cannot locate the unchanged native receive call');
// Fixture-only synchronization BEFORE the real call starts its deadline.
peer = peer.replace(receive, 'DtlsShutdownCases.ReceiveAfterGate(Id, tr, buf, 0, buf.Length, 1000);');
const readerLoop = 'while (!closed)';
const takeDatagram = 'p.dtlsIn.TryTake(out d, waitMillis)';
if (peer.split(readerLoop).length !== 2 || peer.split(takeDatagram).length !== 2)
  throw new Error('Cannot observe the native reader loop and its datagram wait');
peer = peer.replace(readerLoop, 'while (DtlsShutdownCases.ReadAgain(Id, closed))')
  .replace(takeDatagram, 'DtlsShutdownCases.TakeDatagram(p.dtlsIn, out d, waitMillis)');
const dll = lc.build({ files, sources: [ice.replace(binding, 'bound = IPAddress.Loopback;'), peer], exe: true,
  main: 'Thornswood.DtlsShutdownCases', resources: { 'hrtf-composite.wav': path.join(root, 'launcher', 'hrtf-composite.wav') } });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-dtls-shutdown-'));
try {
  const result = lc.run(dll, [], { cwd: dir, timeout: 30000 });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  for (const name of ['orderly.log', 'unestablished.log']) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (text) { process.stderr.write(text); process.exitCode = 1; }
  }
  if (result.status !== 0) process.exitCode = 1;
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
