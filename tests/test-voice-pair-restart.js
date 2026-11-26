'use strict';
// #6530: three native peers, real loopback ICE/DTLS and one-way loss.
// No live service, profile, credentials, audio device, STUN or TURN.
const fs = require('fs');
const os = require('os');
const path = require('path');
const lc = require('./launcher-csc');
const root = path.resolve(__dirname, '..');
const files = ['VoiceSession', 'VoiceLoop', 'VoicePeer', 'VoiceStun', 'VoiceMix', 'VoiceMeter', 'VoiceHrtf', 'Swallow', 'Failure']
  .map((n) => path.join(root, 'launcher', 'app', n + '.cs'));
files.push(path.join(__dirname, 'voice-launcher', 'StandIns.cs'), path.join(__dirname, 'voice-launcher', 'Driver.cs'), path.join(__dirname, 'voice-launcher', 'HrtfTool.cs'),
  path.join(__dirname, 'voice-launcher', 'ShutdownCases.cs'),
  path.join(__dirname, 'voice-pair-restart', 'PairRestartCases.cs'));
const ice = fs.readFileSync(path.join(root, 'launcher', 'app', 'VoiceIce.cs'), 'utf8');
const binding = 'bound = DefaultLocal();';
if (ice.split(binding).length !== 2) throw new Error('Unexpected ICE constructor; cannot guarantee loopback binding');
const dll = lc.build({ files, sources: [ice.replace(binding, 'bound = IPAddress.Loopback;')], exe: true,
  main: 'Thornswood.PairRestartCases', resources: { 'hrtf-composite.wav': path.join(root, 'launcher', 'hrtf-composite.wav') } });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-pair-restart-'));
try {
  const result = lc.run(dll, [], { cwd: dir, timeout: 100000 });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  let swallowed = '';
  try { swallowed = fs.readFileSync(path.join(dir, 'swallowed.log'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (swallowed) { process.stderr.write(swallowed); process.exitCode = 1; }
  if (result.status !== 0) process.exitCode = 1;
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
