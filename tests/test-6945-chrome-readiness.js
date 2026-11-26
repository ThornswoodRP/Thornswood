'use strict';
// Drive the actual helper with owned-process/DevTools doubles, never a browser
// or a real profile. Stream readiness must not consult DevToolsActivePort.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const source = fs.readFileSync(path.join(__dirname, 'chrome-audio.js'), 'utf8');
let pass = 0, fail = 0;
function yes(name, ok) { console.log((ok ? 'PASS  ' : 'FAIL  ') + name); if (ok) pass++; else fail++; }

async function run(options = {}) {
  const trace = { reads: 0, exists: 0, fetch: [], sockets: [], close: 0, kill: 0, removed: [], waits: [], partialFetch: false };
  let now = 0;
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
  child.finish = (code) => { if (child.exitCode === null) { child.exitCode = code; child.emit('exit', code); } };
  child.kill = () => { trace.kill++; child.finish(-1); };
  const fakeFs = {
    mkdtempSync(prefix) { trace.dir = prefix + 'OWNED1'; return trace.dir; },
    existsSync(file) { if (file.endsWith('DevToolsActivePort')) trace.exists++; return !!options.busy; },
    readFileSync() { trace.reads++; const e = Error('profile is busy'); e.code = 'EBUSY'; throw e; },
    rmSync(dir, flags) { trace.removed.push({ dir, flags }); },
  };
  const fakeCp = {
    spawn(exe, args, config) {
      trace.exe = exe; trace.args = args; trace.stdio = config.stdio;
      queueMicrotask(() => {
        for (const [channel, chunk] of options.chunks || []) {
          child[channel].write(Buffer.from(chunk));
          if (!chunk.includes('\n') && trace.fetch.length) trace.partialFetch = true;
        }
        if (options.exit !== undefined) child.finish(options.exit);
      });
      return child;
    },
    spawnSync(exe, args, config) { trace.waits.push({ exe, args, env: config.env }); return { status: 0, stdout: '', stderr: '' }; },
  };
  class Socket {
    constructor(url) { this.url = url; trace.sockets.push(url); queueMicrotask(() => { if (this.onopen) this.onopen(); }); }
    send(text) {
      const request = JSON.parse(text);
      if (request.method === 'Browser.close') { trace.close++; child.finish(0); }
      else queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id: request.id, result: { result: { value: 'rendered' } } }) }));
    }
    close() {}
  }
  const sandbox = {
    module: { exports: {} }, URL, Buffer,
    require(name) { return { fs: fakeFs, os: { tmpdir: () => '/owned-temp', platform: () => options.windows ? 'win32' : 'linux' }, path, child_process: fakeCp }[name]; },
    process: { env: {} }, Date: { now: () => now }, WebSocket: Socket,
    setTimeout(fn, ms) { return setTimeout(() => { now += options.advance || ms; fn(); }, 0); }, clearTimeout,
    async fetch(url) { trace.fetch.push(String(url)); return { json: async () => [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/owned' }] }; },
  };
  vm.runInNewContext(source, sandbox, { filename: 'actual-chrome-audio.js' });
  let value, error;
  try { value = await sandbox.module.exports.evaluate('owned-chrome', 'audio-expression', options.ms); }
  catch (e) { error = e; }
  return { value, error, trace, now };
}
const endpoint = 'ws://127.0.0.1:9222/devtools/browser/owned-123';
(async () => {
  for (const channel of ['stdout', 'stderr']) {
    const r = await run({ chunks: [[channel, 'unrelated startup noise\nDevTools list'], [channel, 'ening on ' + endpoint.slice(0, 24)], [channel, endpoint.slice(24) + '\r\n']] });
    yes(channel + ' fragmented complete announcement reaches actual evaluation', r.value === 'rendered' && !r.error && !r.trace.partialFetch);
    yes(channel + ' readiness uses its loopback endpoint and owned Browser.close', r.trace.fetch[0] === 'http://127.0.0.1:9222/json/list' && r.trace.sockets.includes(endpoint) && r.trace.close === 1 && r.trace.kill === 0);
    yes(channel + ' cleanup removes only the owned profile after exit', r.trace.removed.length === 1 && r.trace.removed[0].dir === r.trace.dir && r.trace.removed[0].flags.recursive && r.trace.removed[0].flags.force);
  }
  const busy = await run({ busy: true, windows: true, chunks: [['stderr', 'DevTools listening on ' + endpoint + '\n']] });
  yes('a busy profile readiness file is never consulted', busy.value === 'rendered' && busy.trace.reads === 0 && busy.trace.exists === 0);
  yes('existing Chrome flags and owned-profile wait remain in use', busy.trace.args.join('|') === ['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir=' + busy.trace.dir,'about:blank'].join('|') && busy.trace.waits.length === 1 && busy.trace.waits[0].env.TS_CHROME_DIR === path.basename(busy.trace.dir));
  for (const [host, port] of [['127.0.0.1', 1], ['localhost', 80], ['[::1]', 65535]]) {
    const url = 'ws://' + host + ':' + port + '/devtools/browser/owned';
    const r = await run({ chunks: [['stdout', 'DevTools listening on ' + url + '\n']] });
    yes('valid explicit loopback endpoint ' + host + ':' + port, r.value === 'rendered' && r.trace.fetch[0] === 'http://' + new URL(url).host + '/json/list');
  }
  for (const url of ['ws://192.0.2.1:9222/devtools/browser/owned', 'ws://127.0.0.1:0/devtools/browser/owned', 'ws://127.0.0.1:65536/devtools/browser/owned', 'ws://127.0.0.1:9222/devtools/page/owned']) {
    const r = await run({ advance: 60001, chunks: [['stderr', 'DevTools listening on ' + url + '\n']] });
    yes('invalid announcement cannot create readiness: ' + url, !!r.error && /did not open.*60 s/.test(r.error.message) && r.trace.fetch.length === 0);
  }
  const partial = await run({ advance: 60001, chunks: [['stderr', 'DevTools listening on ' + endpoint]] });
  yes('a line fragment without its terminator is not a complete announcement', !!partial.error && partial.trace.fetch.length === 0);
  const mixed = await run({ advance: 60001, chunks: [['stdout', 'DevTools listening on ws://127.0.0.1:9222/devtools/browser/'], ['stderr', 'owned\n']] });
  yes('fragments on separate channels cannot be joined into an endpoint', !!mixed.error && mixed.trace.fetch.length === 0);
  const missing = await run({ advance: 60001, chunks: [['stdout', 'noise only\n'], ['stderr', 'startup diagnostic\n']] });
  yes('missing announcement retains the original 60-second budget and diagnostics', !!missing.error && /60 s/.test(missing.error.message) && /startup diagnostic/.test(missing.error.message) && missing.trace.kill === 1 && missing.trace.removed.length === 1);
  const exited = await run({ exit: 7, chunks: [['stderr', 'startup refused\n']] });
  yes('early process exit still fails and cleans its profile', !!exited.error && /stopped \(exit 7\)/.test(exited.error.message) && /startup refused/.test(exited.error.message) && exited.trace.removed.length === 1);
  const limited = await run({ ms: 75 });
  yes('an explicit smaller whole-run budget is preserved', !!limited.error && limited.now === 100 && limited.trace.fetch.length === 0);
})().catch(e => { fail++; console.log('FAIL  the harness itself: ' + e.stack); }).finally(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
});
