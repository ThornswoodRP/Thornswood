/*
  test-voice-hrtf.js

      node tests\test-voice-hrtf.js

  #963 point 4, decided by Patrick on 28 Sep: every voice panner is HRTF, none
  cheaper. Since voice left the web view (#4823) the launcher mixes it itself
  (launcher\app\VoiceMix.cs), and its panner is Chromium's HRTF panner ported
  to C# (launcher\app\VoiceHrtf.cs) with Chromium's own impulse responses
  (launcher\hrtf-composite.wav). This checks that it is that panner, by
  measuring it against Chrome:

    1. The data: the file is 240 stereo responses of 256 frames, 16-bit at
       44.1 kHz, the bytes THIRD-PARTY.md records, the same samples Firefox
       ships from the IRCAM Listen database, and the launcher and the voice
       driver both embed it under the name the code reads.
    2. The FFT the port is built on, against a plain DFT and back.
    3. Where a voice is: the PannerNode's azimuth and elevation for the
       default listener (ahead, right, left, behind, above, below).
    4. The same signal through the launcher's panner and through Chrome's own
       PannerNode (panningModel 'HRTF', in an OfflineAudioContext at 48 kHz),
       moved from place to place every few hundred milliseconds, a move
       while a crossfade is still running, and moves inside a stretch of
       silence. Every frame of both ears has to agree to within -80 dB of
       the loudest; the port measured -104 dB on 1 Nov. Inside the silence,
       where the panner skips its work, every quantum Chrome leaves exactly
       0 has to be exactly 0 from the launcher too. The same render
       with every place mirrored left for right is far off, so the
       comparison can tell one place from another. Needs a Chrome or
       Chromium (CHROME names one); without one these checks say SKIP.
    5. The mix uses it: VoiceMix pans every voice through HrtfPanner, the
       equal-power panner is gone, the data is built on the thread pool and
       a panner never waits for it.
    6. What it costs: the data's build, and the mix's CPU per person talking
       and per person silent, measured, with a ceiling well above what was
       measured so only something many times worse fails.
    7. The notices: the two licence texts are in installer\licences and on
       InstallSteps.LicenceFiles, and THIRD-PARTY.md and the credits page
       carry them word for word.

  Runs the launcher's own C# through tests\voice-launcher.js (the .NET 10
  SDK); writes only to temp folders.
*/
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const VL = require('./voice-launcher');
const Chrome = require('./chrome-audio');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8').split(String.fromCharCode(13)).join('');
let pass = 0, fail = 0, skip = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function skipped(what, why) { skip++; console.log('SKIP  ' + what + ' (' + why + ')'); }

const RATE = 48000, Q = 128;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-hrtf-'));
let built = null;
function tool(args) {
  built = built || VL.build();
  const r = cp.spawnSync(built.dotnet, [built.dll, '--hrtf'].concat(args), { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) { throw new Error('the HRTF tool failed (' + args[0] + '): ' + r.stdout + r.stderr); }
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// ------------------------------------------------------------------ 1. data --
function partOne() {
  console.log('1. the impulse responses:');
  const file = path.join(REPO, 'launcher', 'hrtf-composite.wav');
  const wav = fs.readFileSync(file);
  const sha = crypto.createHash('sha256').update(wav).digest('hex');
  const fmtAt = wav.indexOf('fmt ');
  const dataAt = wav.indexOf('data');
  const channels = wav.readUInt16LE(fmtAt + 10), rate = wav.readUInt32LE(fmtAt + 12), bits = wav.readUInt16LE(fmtAt + 22);
  const bytes = wav.readUInt32LE(dataAt + 4);
  yes('launcher\\hrtf-composite.wav is 16-bit stereo at 44.1 kHz, 240 responses of 256 frames (' + bits + '-bit, ' + channels + ' channels, ' + rate + ' Hz, ' + bytes / 4 + ' frames)',
      wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE' && wav.readUInt16LE(fmtAt + 8) === 1 &&
      channels === 2 && rate === 44100 && bits === 16 && bytes === 240 * 256 * 4);
  yes('its bytes are the ones THIRD-PARTY.md records (' + sha.slice(0, 16) + '...)', read('THIRD-PARTY.md').indexOf(sha) >= 0);
  // Firefox's copy of the same data (IRC_Composite_C_R0195-incl.cpp) opens
  // azimuth 0, elevation 315, left ear, with these six samples; in the file
  // that response is the eighth (elevations run 0..90, then 315, 330, 345).
  const at = dataAt + 8 + 7 * 256 * 4;
  const six = [0, 1, 2, 3, 4, 5].map((i) => wav.readInt16LE(at + 4 * i));
  yes('the samples are the ones Firefox ships from the IRCAM Listen database (' + six.join(', ') + ')',
      JSON.stringify(six) === JSON.stringify([-37, 37, -38, 39, -39, 40]));
  yes('the launcher embeds it under the name VoiceHrtf.cs reads',
      /<EmbeddedResource Include="\.\.\\hrtf-composite\.wav"><LogicalName>hrtf-composite\.wav<\/LogicalName><\/EmbeddedResource>/.test(read('launcher/app/Thornswood.csproj')) &&
      /GetManifestResourceStream\("hrtf-composite\.wav"\)/.test(read('launcher/app/VoiceHrtf.cs')));
  yes('and so does the voice driver the harnesses run',
      /<EmbeddedResource Include="\.\.\/\.\.\/launcher\/hrtf-composite\.wav" LogicalName="hrtf-composite\.wav" \/>/.test(read('tests/voice-launcher/VoiceDriver.csproj')));
}

// ------------------------------------------------------------------ 2. FFT --
function partTwo() {
  console.log('\n2. the FFT:');
  const r = tool(['fft']);
  yes('the packed real FFT matches a plain DFT (worst ' + r.forward.toExponential(1) + ' of the size)', r.forward < 1e-6);
  yes('and its inverse gives the signal back (worst ' + r.back.toExponential(1) + ')', r.back < 1e-5);
}

// ------------------------------------------------------------- 3. azimuth --
function partThree() {
  console.log('\n3. where a voice is:');
  const places = [
    ['ahead', [0, 0, -1], 0, 0], ['to the right', [1, 0, 0], 90, 0], ['to the left', [-1, 0, 0], -90, 0],
    ['behind', [0, 0, 1], -180, 0], ['above', [0, 1, 0], 0, 90], ['below', [0, -1, 0], 0, -90],
    ['ahead and up at 45 degrees', [0, 1, -1], 0, 45], ['behind and to the right', [1, 0, 1], 135, 0],
  ];
  const file = path.join(tmp, 'places.json');
  fs.writeFileSync(file, JSON.stringify(places.map((p) => ({ x: p[1][0], y: p[1][1], z: p[1][2] }))));
  const r = tool(['azimuth', file]);
  places.forEach((p, i) => {
    yes('a voice ' + p[0] + ' is at azimuth ' + p[2] + ', elevation ' + p[3] + ' (' + r.azimuth[i].toFixed(3) + ', ' + r.elevation[i].toFixed(3) + ')',
        Math.abs(r.azimuth[i] - p[2]) < 1e-3 && Math.abs(r.elevation[i] - p[3]) < 1e-3);
  });
}

// --------------------------------------------------------------- 4. Chrome --
/*
  A move takes effect from the quantum it is set in, on both sides. Chrome
  takes a position set while an OfflineAudioContext is suspended as an
  automation event at currentTime, and where currentTime times the rate
  comes out a hair above the quantum's first frame (q = 210 does) the event
  starts a frame in and the k-rate panner reads it a quantum later. So the
  moves are on quanta where that product is exact or below, and the harness
  says so if one is not.
*/
const MOVES = [
  { q: 0, x: 0, y: 0, z: -1 }, { q: 30, x: 1, y: 0, z: 0 }, { q: 45, x: 1, y: 0, z: 1 },
  { q: 60, x: 0, y: 0, z: 1 }, { q: 62, x: -1, y: 0.2, z: 0.3 }, { q: 90, x: -1, y: 0, z: 0 },
  { q: 120, x: 0, y: 1, z: -0.1 }, { q: 150, x: 0.3, y: -1, z: -0.5 }, { q: 180, x: 2, y: 0.5, z: -3 },
  { q: 209, x: -2, y: 0, z: -1 }, { q: 230, x: 0.5, y: 0.5, z: 0.5 }, { q: 300, x: 0.1, y: 0, z: -1 },
  { q: 301, x: 0.2, y: 0, z: -1 }, { q: 330, x: 3, y: -1, z: 2 }, { q: 400, x: -0.7, y: 0.7, z: 0 },
];
const QUANTA = 500;
const SILENT_FROM = 200, SILENT_TO = 260;

function signal() {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const x = new Float32Array(QUANTA * Q);
  for (let i = 0; i < x.length; i++) { x[i] = (rnd() * 2 - 1) * 0.5; }
  for (let i = SILENT_FROM * Q; i < SILENT_TO * Q; i++) { x[i] = 0; }
  return x;
}

function launcherRender(input, moves) {
  fs.writeFileSync(path.join(tmp, 'in.f32'), Buffer.from(input.buffer));
  fs.writeFileSync(path.join(tmp, 'moves.json'), JSON.stringify(moves));
  tool(['render', path.join(tmp, 'in.f32'), path.join(tmp, 'moves.json'), path.join(tmp, 'out.f32')]);
  const b = fs.readFileSync(path.join(tmp, 'out.f32'));
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
}

function chromePage(input, moves) {
  return `(async () => {
    const bin = atob(${JSON.stringify(Buffer.from(input.buffer).toString('base64'))});
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const input = new Float32Array(bytes.buffer);
    const moves = ${JSON.stringify(moves)};
    const ctx = new OfflineAudioContext(2, ${input.length}, ${RATE});
    const buf = ctx.createBuffer(1, ${input.length}, ${RATE});
    buf.copyToChannel(input, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // The page's panner, as launcher\\voice-host.html and the overlay made it.
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1;
    p.rolloffFactor = 0;
    src.connect(p).connect(ctx.destination);
    const at = (m) => { p.positionX.value = m.x; p.positionY.value = m.y; p.positionZ.value = m.z; };
    for (const m of moves) {
      if (m.q === 0) { at(m); continue; }
      ctx.suspend(m.q * ${Q} / ${RATE}).then(() => { at(m); ctx.resume(); });
    }
    src.start(0);
    const out = await ctx.startRendering();
    const l = out.getChannelData(0), r = out.getChannelData(1);
    const both = new Float32Array(l.length * 2);
    for (let i = 0; i < l.length; i++) { both[2 * i] = l[i]; both[2 * i + 1] = r[i]; }
    const ob = new Uint8Array(both.buffer);
    let s = '';
    for (let i = 0; i < ob.length; i += 0x8000) s += String.fromCharCode.apply(null, ob.subarray(i, i + 0x8000));
    return btoa(s);
  })()`;
}

function compare(a, b) {
  let peak = 0, worst = 0, at = 0;
  for (let i = 0; i < b.length; i++) {
    peak = Math.max(peak, Math.abs(b[i]));
    const d = Math.abs(a[i] - b[i]);
    if (d > worst) { worst = d; at = i; }
  }
  return { peak: peak, worst: worst, db: 20 * Math.log10(Math.max(worst, 1e-30) / peak), quantum: Math.floor(at / 2 / Q) };
}

async function partFour() {
  console.log('\n4. against Chrome\'s own PannerNode:');
  const late = MOVES.filter((m) => (m.q * Q / RATE) * RATE > m.q * Q);
  if (late.length) { throw new Error('moves on quanta Chrome takes a quantum late: ' + late.map((m) => m.q).join(', ')); }
  const exe = Chrome.find();
  const what = ['every frame of both ears matches Chrome\'s to within -80 dB', 'in the silent stretch the launcher is exactly silent in every quantum Chrome is', 'and a render with every place mirrored does not'];
  if (!exe) { what.forEach((w) => skipped(w, 'no Chrome or Chromium on this machine; CHROME names one')); return; }
  console.log('      ' + Chrome.version(exe));
  const input = signal();
  const mine = launcherRender(input, MOVES);
  const b64 = await Chrome.evaluate(exe, chromePage(input, MOVES), 180000);
  const raw = Buffer.from(b64, 'base64');
  const theirs = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  yes('Chrome rendered the same length (' + theirs.length / 2 + ' frames, the launcher ' + mine.length / 2 + ')', theirs.length === mine.length);
  const c = compare(mine, theirs);
  yes(what[0] + ' (worst ' + c.db.toFixed(1) + ' dB, in quantum ' + c.quantum + ', peak ' + c.peak.toFixed(3) + ')', c.peak > 0.1 && c.db < -80);
  // In the silent stretch the panner skips work once its filters are empty.
  // Just after the voice stops, both sides play its tail and then a few
  // quanta of float rounding (around 1e-8, a zero here and there on either
  // side by chance); a move there brings in the other filter set, which
  // still holds the end of the last voice it played. Where Chrome's whole
  // quantum is exactly 0 its filters are empty, and the launcher's has to be
  // exactly 0 as well, skipped or not; the comparison above holds every
  // other frame to Chrome's.
  let still = 0, missed = 0, sounding = 0;
  for (let q = SILENT_FROM; q < SILENT_TO; q++) {
    let theirsZero = true, mineZero = true;
    for (let i = q * Q * 2; i < (q + 1) * Q * 2; i++) { if (theirs[i] !== 0) { theirsZero = false; } if (mine[i] !== 0) { mineZero = false; } }
    if (!theirsZero) { sounding++; } else { still++; if (!mineZero) { missed++; } }
  }
  yes('in the silent stretch, with moves inside it, the launcher is exactly silent in every quantum Chrome is (' + still + ' quanta, ' + missed +
      ' not silent; ' + sounding + ' not silent in Chrome either, the tail and the filters a move brings back)', still >= 16 && missed === 0);
  const mirrored = launcherRender(input, MOVES.map((m) => ({ q: m.q, x: -m.x, y: m.y, z: m.z })));
  const m = compare(mirrored, theirs);
  yes(what[2] + ' (' + m.db.toFixed(1) + ' dB)', m.db > -20);
}

// ------------------------------------------------------------------ 5. mix --
function partFive() {
  console.log('\n5. the mix:');
  const mix = read('launcher/app/VoiceMix.cs');
  const hrtf = read('launcher/app/VoiceHrtf.cs');
  yes('every voice in the mix goes through its own HrtfPanner', /public readonly HrtfPanner Panner;/.test(mix) && /s\.Panner\.Pan\(/.test(mix));
  yes('and the equal-power panner is gone', !/EqualPower|equal.power|\bLeftTarget\b/i.test(mix.replace(/\/\/\/[^\n]*|\/\/[^\n]*/g, '')));
  yes('the data is built on the thread pool, once, from the first mix on',
      /readonly Task<HrtfDatabase> hrtf = HrtfDatabase\.Shared\(\);/.test(mix) && /shared = Task\.Run\(/.test(hrtf));
  yes('and a panner never waits for it: until it is built the voice goes to both ears as it is',
      /HrtfDatabase database = t\.IsCompletedSuccessfully \? t\.Result : null;/.test(hrtf) && !/\.Wait\(/.test(hrtf) && !/\.Wait\(/.test(mix));
  yes('a build that fails is said in the launcher log, not left silent',
      /mix\.Hrtf\.ContinueWith\(/.test(read('launcher/app/VoiceSession.cs')));
  yes('only taking the frames is under the mix\'s lock; the filtering is the speakers\' thread\'s',
      /lock \(gate\)\s*\{\s*foreach \(Source s in sources\.Values\)[\s\S]*?work\.Add\(s\);\s*\}\s*\}\s*Array\.Clear\(mixL\);[\s\S]*?s\.Panner\.Pan\(/.test(mix));
}

// ----------------------------------------------------------------- 6. cost --
function partSix() {
  console.log('\n6. what it costs:');
  const r = tool(['bench', '8', '5']);
  const pct = (v) => (100 * v).toFixed(2) + '% of one core';
  console.log('      building the data: ' + Math.round(r.buildMs) + ' ms on the thread pool');
  console.log('      the mix with nobody in it: ' + pct(r.coreShareEmpty));
  console.log('      each person talking: ' + pct(r.coreSharePerTalker) + '; each person silent: ' + pct(r.coreSharePerSilent));
  yes('the data builds in under five seconds (' + Math.round(r.buildMs) + ' ms)', r.buildMs < 5000);
  yes('a person talking costs under 5% of one core (' + pct(r.coreSharePerTalker) + ')', r.coreSharePerTalker < 0.05);
  yes('a person silent costs less than half of one talking, since silence into empty filters is skipped (' + pct(r.coreSharePerSilent) + ')',
      r.coreSharePerSilent < r.coreSharePerTalker / 2);
}

// ------------------------------------------------------------- 7. notices --
function partSeven() {
  console.log('\n7. the notices:');
  const lic = path.join(REPO, 'installer', 'licences');
  const files = ['Chromium-HRTF-LICENSE.txt', 'IRCAM-Listen-HRTF.txt'];
  const steps = read('launcher/app/InstallSteps.cs');
  files.forEach((f) => {
    yes('installer\\licences\\' + f + ' is there and on InstallSteps.LicenceFiles',
        fs.existsSync(path.join(lic, f)) && steps.indexOf('"' + f + '"') >= 0);
  });
  const flat = (s) => s.replace(/\s+/g, ' ');
  const chromium = read('installer/licences/Chromium-HRTF-LICENSE.txt');
  const blocks = [chromium.slice(chromium.indexOf('Copyright (C) 2010, Google Inc.'), chromium.indexOf('--- hrtf_elevation.cc')),
    chromium.slice(chromium.indexOf('Copyright (C) 2010 Google Inc.'), chromium.indexOf('--- Chromium\'s LICENSE ---')),
    chromium.slice(chromium.indexOf('// Copyright 2015 The Chromium Authors'))];
  const T = flat(read('THIRD-PARTY.md')), C = flat(read('site/data/site/credits.md'));
  yes('THIRD-PARTY.md carries the three Chromium notices word for word', blocks.every((b) => b.length > 500 && T.indexOf(flat(b).trim()) >= 0));
  yes('and so does the credits page', blocks.every((b) => C.indexOf(flat(b).trim()) >= 0));
  const ircam = read('installer/licences/IRCAM-Listen-HRTF.txt');
  const quote = ircam.slice(ircam.indexOf('"Use of Materials'), ircam.indexOf('development."') + 13);
  yes('both carry IRCAM\'s terms and acknowledge the Listen database', quote.length > 50 &&
      T.indexOf(flat(quote)) >= 0 && C.indexOf(flat(quote)) >= 0 && /IRCAM Listen HRTF Database/.test(C));
  yes('THIRD-PARTY.md names the Chromium commit the port is from', T.indexOf('dd2ed7a22c23f9c9a85e9514c8c3308bf6ae4fbe') >= 0 &&
      read('launcher/app/VoiceHrtf.cs').indexOf('dd2ed7a2') >= 0);
}

(async () => {
  partOne();
  partTwo();
  partThree();
  await partFour();
  partFive();
  partSix();
  partSeven();
})().catch((e) => {
  fail++;
  console.log('FAIL  the harness itself: ' + (e && e.stack || e));
}).then(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + pass + ' passed, ' + fail + ' failed' + (skip ? ', ' + skip + ' skipped' : ''));
  process.exit(fail ? 1 : 0);
});
