'use strict';
const fs = require('node:fs');
const path = require('node:path');
const app = name => fs.readFileSync(path.join(__dirname, '..', 'app', name + '.cs'), 'utf8');
const audio = app('VoiceAudio');
const worker = app('VoiceDefaultDevices');
const session = app('VoiceSession');
const mix = app('VoiceMix');
const capture = audio.slice(audio.indexOf('unsafe Func<int> CapturePackets'), audio.indexOf('unsafe int RenderAudio'));
const playback = audio.slice(audio.indexOf('unsafe int RenderAudio'));
let failed = 0;
function check(name, ok) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) failed++;
}
check('audio teardown wakes and joins both workers before releasing the stop handle',
  /stopping\.Set\(\);[\s\S]*?mic\?\.Join\(\);\s*speakers\?\.Join\(\);\s*stopping\.Dispose\(\);/.test(audio) &&
  /WaitHandle\.WaitAny\(signals, ProbeMilliseconds\)/.test(worker));
check('neither stream starts without a WASAPI wake handle', /result = client\.SetEventHandle\([^\n]+\);\s*if \(result != 0\) return null;[\s\S]*?result = client\.Start\(\);/.test(audio));
check('an empty capture status keeps the stream open without releasing a packet',
  /GetBuffer\([\s\S]*?if \(result < 0\) return result;[\s\S]*?if \(result == VoiceCom\.AUDCLNT_S_BUFFER_EMPTY \|\| frames == 0\) break;/.test(capture));
check('playback will not start without a buffer size', /result = client\.GetBufferSize\([^\n]+\);\s*if \(result != 0\) return null;/.test(audio));
check('native packet ownership survives a callback exception',
  /try\s*\{[\s\S]*?OnFrame\(frame\);[\s\S]*?finally\s*\{[^}]*packets\.ReleaseBuffer\(frames\)/.test(capture) &&
  /try\s*\{\s*mix\.Render\([\s\S]*?finally\s*\{[^}]*render\.ReleaseBuffer\(/.test(playback));
check('render stays stereo and receives the spatial mix', /FloatFormat\(VoiceMix\.Rate, capture \? 1 : 2\)/.test(audio) &&
  /mix\.Render\(samples, \(int\)room\)/.test(playback) && /mix\.SetLevel\(id, level,/.test(session) &&
  session.includes('mix.SetPosition(id, right, up, -forward)') && mix.includes('s.Panner.Pan('));
check('capture stays one mono frame per Opus encode while talking', capture.includes('new float[VoiceMix.Frame]') &&
  /if \(!micLive\) return;[\s\S]*?encoder\.Encode\(pcm, VoiceMix\.Frame, packet, packet\.Length\)/.test(session));
check('both workers use the Windows watcher and the existing selection policies',
  /using var watcher = WatchDefaults\(enumerator, label\);[\s\S]*?VoiceEndpointWorker\.Run\(flow, stopping, watcher\?\.Changes/.test(audio) &&
  audio.includes('Mics.OpenForVoice(enumerator, cfg') && audio.includes('AudioOutput.OpenForVoice(enumerator, cfg.AudioOutputId'));
process.exitCode = Number(failed !== 0);
