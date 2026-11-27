// #6552: execute the shipped chat client with the native/legacy channel data.
// No network, game, credentials or timers outside this sandbox.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const CHAT = fs.readFileSync(path.join(ROOT, 'game/ui/thornswood-chat.js'), 'utf8');
const FRONT = fs.readFileSync(path.join(ROOT, 'game/plugins/thornswood-front.js'), 'utf8');
const CONFIG = fs.readFileSync(path.join(ROOT, 'launcher/app/Config.cs'), 'utf8');
const DEV = { host: CONFIG.match(/public string ServerAddress = "([^"]+)"/)[1], port: 7789 };
const DIRECT = 'wss://dev-signal.thornswood.net:44789/voice-dev/';
const MAIN_DIRECT = 'wss://main-signal.thornswood.net:44789/voice/';
let passed = 0, failed = 0;
function check(name, action) {
  try { action(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + ': ' + e.message); }
}
function page(change) {
  const made = [], asks = [];
  function Socket(url, protocols) {
    this.url = url; this.protocols = protocols; this.readyState = 0; this.sent = [];
    made.push(this);
  }
  Socket.prototype.send = function (text) { this.sent.push(JSON.parse(text)); };
  Socket.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose({}); };
  Socket.prototype.admit = function () {
    this.readyState = 1; this.onopen({});
    this.onmessage({ data: JSON.stringify({ t: 'welcome', peer: made.length, profileId: 7 }) });
  };
  const cfg = Object.assign({ profileId: 7,
    name: 'Fixture', token: 'fixture-first', base: 'https://thornswood.net/voice-dev', socket: DIRECT }, DEV, change);
  const win = { THORNSWOOD: cfg, thornswoodChat: { add() {} },
    skyrimPlatform: { sendMessage(to, line) { asks.push({ to, line }); } } };
  let timer = 0;
  const box = { window: win, WebSocket: Socket, setTimeout() { return ++timer; },
    setInterval() { return ++timer; }, clearTimeout() {}, clearInterval() {},
    Date: { now: () => 1000000 }, Math, JSON, Number, String, Object, Array, isFinite, parseInt, console };
  vm.runInNewContext(CHAT, box, { filename: 'thornswood-chat.js' });
  return { made, win, asks };
}
check('Dev chat opens the dedicated trusted socket', () => assert.strictEqual(page().made[0].url, DIRECT));
check('the base used for HTTPS authentication is unchanged', () => {
  const p = page(); assert.strictEqual(p.win.THORNSWOOD.base, 'https://thornswood.net/voice-dev');
  assert.deepStrictEqual(Array.from(p.made[0].protocols), ['thornswood', 'fixture-first']);
  assert(!p.made[0].url.includes('fixture-first'));
});
check('Main ignores a stale Dev socket in a shared game folder', () => {
  assert.strictEqual(page({ port: 7778, base: 'https://thornswood.net/voice' }).made[0].url, 'wss://thornswood.net/voice/');
});
check('a custom game route does not acquire the dedicated socket', () => {
  assert.strictEqual(page({ host: 'private.example.invalid' }).made[0].url, 'wss://thornswood.net/voice-dev/');
  assert.strictEqual(page({ host: 'private.example.invalid', base: 'https://private.example.invalid/voice-dev' }).made[0].url,
    'wss://private.example.invalid/voice-dev/');
});
check('a stale Dev HTTPS base and socket do not override the Main voice port', () => {
  assert.strictEqual(page({ port: 7778 }).made[0].url, 'wss://thornswood.net/voice-dev/');
});
check('a custom HTTPS service on the canonical game keeps its route', () => {
  assert.strictEqual(page({ base: 'https://custom.example.invalid/voice-dev' }).made[0].url, 'wss://custom.example.invalid/voice-dev/');
});
check('a missing legacy socket field retains the old secure route', () => {
  assert.strictEqual(page({ socket: undefined }).made[0].url, 'wss://thornswood.net/voice-dev/');
});
check('an unrelated or insecure socket value is never used', () => {
  for (const socket of ['ws://dev-signal.thornswood.net:44789/voice-dev/', 'wss://other.example.invalid/', DIRECT + 'extra'])
    assert.strictEqual(page({ socket }).made[0].url, 'wss://thornswood.net/voice-dev/');
});
check('reconnection takes a fresh token and ignores retired callbacks on the same Dev route', () => {
  const p = page(), first = p.made[0]; first.admit(); first.close();
  p.win.thornswoodNet.setToken('fixture-second');
  assert.strictEqual(p.made.length, 2);
  const second = p.made[1]; second.admit();
  assert.strictEqual(second.url, DIRECT); assert.strictEqual(second.protocols[1], 'fixture-second');
  first.onclose({}); assert.strictEqual(second.readyState, 1);
});
check('both real front bootstrap objects pass the independent socket and original base', () => {
  const objects = Array.from(FRONT.matchAll(/JSON\.stringify\((\{[^}]*\bbase:\s*VOICE_URL[^}]*\})\)/g), m => m[1]);
  assert.strictEqual(objects.length, 2, 'early line and normal overlay bootstrap');
  for (const object of objects) {
    const cfg = vm.runInNewContext('(' + object + ')', { HOST: DEV.host, VOICE_PORT: DEV.port,
      PROFILE: 7, lineId: 7, sentName: 'Fixture', tok: '', VOICE_URL: 'https://thornswood.net/voice-dev',
      VOICE_SOCKET_URL: DIRECT, CHAT_FADE: 1, NEEDS_BARS: true, TEXT_SIZE: 100 });
    assert.strictEqual(cfg.socket, DIRECT); assert.strictEqual(cfg.base, 'https://thornswood.net/voice-dev');
  }
});
check('front reads the separate socket key and preserves missing legacy input', () => {
  const body = FRONT.match(/const VOICE_SOCKET_URL\s*=\s*(\(function\s*\(\)\s*\{[\s\S]*?\}\)\(\));/);
  assert(body, 'separate INI socket reader');
  assert.strictEqual(vm.runInNewContext(body[1], { ini: 'VoiceSocketUrl = ' + DIRECT }), DIRECT);
  assert.strictEqual(vm.runInNewContext(body[1], { ini: 'VoiceUrl = https://thornswood.net/voice-dev' }), '');
});
function main(change) { return page(Object.assign({ port: 7778, base: 'https://thornswood.net/voice', socket: MAIN_DIRECT }, change)); }
check('canonical Main chat opens its own trusted socket with the original issuer', () => {
  const p = main(); assert.strictEqual(p.made[0].url, MAIN_DIRECT);
  assert.strictEqual(p.win.THORNSWOOD.base, 'https://thornswood.net/voice');
  assert.deepStrictEqual(Array.from(p.made[0].protocols), ['thornswood', 'fixture-first']);
});
check('custom Main game and service routes keep their derived sockets', () => {
  assert.strictEqual(main({ host: 'private.example.invalid' }).made[0].url, 'wss://thornswood.net/voice/');
  assert.strictEqual(main({ base: 'https://custom.example.invalid/voice' }).made[0].url, 'wss://custom.example.invalid/voice/');
});
check('Main legacy and mismatched-port inputs never use its dedicated route', () => {
  assert.strictEqual(main({ socket: undefined }).made[0].url, 'wss://thornswood.net/voice/');
  assert.strictEqual(main({ port: 7789 }).made[0].url, 'wss://thornswood.net/voice/');
  assert.strictEqual(main({ port: 0 }).made[0].url, 'wss://thornswood.net/voice/');
  assert.strictEqual(main({ port: undefined }).made[0].url, 'wss://thornswood.net/voice/');
  assert.strictEqual(page({ socket: MAIN_DIRECT }).made[0].url, 'wss://thornswood.net/voice-dev/');
  for (const socket of [MAIN_DIRECT.replace('wss:', 'ws:'), MAIN_DIRECT + 'extra'])
    assert.strictEqual(main({ socket }).made[0].url, 'wss://thornswood.net/voice/');
});
check('established Main close reconnects on the same route with a fresh token', () => {
  const p = main(), first = p.made[0]; first.admit(); first.close();
  p.win.thornswoodNet.setToken('fixture-main-second');
  const second = p.made[1]; second.admit();
  assert.strictEqual(second.url, MAIN_DIRECT); assert.strictEqual(second.protocols[1], 'fixture-main-second');
  first.onclose({}); assert.strictEqual(second.readyState, 1);
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
