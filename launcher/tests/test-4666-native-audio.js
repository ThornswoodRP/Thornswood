'use strict';
const fs = require('node:fs');
const path = require('node:path');
const app = (name) => fs.readFileSync(path.join(__dirname, '..', 'app', name + '.cs'), 'utf8').replace(/\r\n/g, '\n');
const audio = app('VoiceAudio');
const session = app('VoiceSession');
const mix = app('VoiceMix');
const capture = audio.slice(audio.indexOf('unsafe int CaptureOnce'), audio.indexOf('int Stopped('));
const playback = audio.slice(audio.indexOf('unsafe int PlaybackOnce'));
let failed = 0;
function check(name, ok) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) failed++;
}
check('audio teardown wakes both workers and joins them before releasing their stop handle', /stopping\.Set\(\);[\s\S]*?mic\?\.Join\(\);\s*speakers\?\.Join\(\);/.test(audio) &&
  (audio.match(/WaitHandle\.WaitAny\(signals, AudioProbeMs\)/g) || []).length === 2);
check('capture will not start without its WASAPI wake handle', /hr = client\.SetEventHandle\([^\n]+\);\n\s*if \(hr != 0\) return Stopped\(hr\);/.test(capture));
check('an empty capture status keeps the stream open without releasing a packet', /GetBuffer\([\s\S]*?if \(hr < 0\) return Stopped\(hr\);\s*\/\/[^\n]+\n\s*if \(hr == VoiceCom\.AUDCLNT_S_BUFFER_EMPTY \|\| frames == 0\) break;/.test(capture));
check('playback will not start without a buffer size and wake handle', ['GetBufferSize', 'SetEventHandle'].every(call =>
  new RegExp('hr = client\\.' + call + '\\([^\\n]+\\);\\n\\s*if \\(hr != 0\\) return PlaybackFailure\\(hr\\);').test(playback)));
check('native packet ownership survives a callback exception', /try\s*\{[\s\S]*?OnFrame\(frame\);[\s\S]*?finally\s*\{[^}]*cap\.ReleaseBuffer\(frames\)/.test(capture) &&
  /try\s*\{\s*mix\.Render\([\s\S]*?finally\s*\{[^}]*ren\.ReleaseBuffer\(/.test(playback));
check('render stays stereo and receives the spatial mix', /FloatFormat\(VoiceMix\.Rate, 2\)/.test(playback) && /mix\.Render\(buf, \(int\)room\)/.test(playback) &&
  /mix\.SetLevel\(id, level,/.test(session) && session.includes('mix.SetPosition(id, right, up, -forward)') && mix.includes('s.Panner.Pan('));
check('capture stays one mono frame per Opus encode while talking', /FloatFormat\(VoiceMix\.Rate, 1\)/.test(capture) && capture.includes('new float[VoiceMix.Frame]') &&
  /if \(!micLive\) return;[\s\S]*?encoder\.Encode\(pcm, VoiceMix\.Frame, packet, packet\.Length\)/.test(session));
process.exitCode = Number(failed !== 0);
