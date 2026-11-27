'use strict';
/* Real account-binding, moderation and compatibility contract. Actual voice
   HTTP/token/WebSocket code runs in an owned child with a synthetic Site.
   Test-only IPC observes private spend/peer context; no HTTP route is added.
   Private account context is nonce-local and never published to clients. */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), crypto = require('node:crypto'), vm = require('node:vm');
const { fork } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = process.env.VOICE || path.join(ROOT, 'voice/voice-server.js');
const source = fs.readFileSync(SOURCE, 'utf8');
const key = crypto.randomBytes(32).toString('hex'), siteKey = crypto.randomBytes(32);
const A = '700000000000000001', B = '700000000000000002', DENIED = '700000000000000003';
const PID = 2001, LEGACY = 2002;
let pass = 0, fail = 0;
function check(name, value) { console.log((value ? 'PASS ' : 'FAIL ') + name); value ? pass++ : fail++; }
function fn(text, name) {
  const start = text.indexOf('function ' + name + '('), end = text.indexOf('\n}', start);
  if (start < 0 || end < 0 || text.indexOf('function ' + name + '(', start + 1) >= 0) throw Error('unique function missing: ' + name);
  const value = text.slice(start, end + 2);
  new vm.Script('(' + value + ')');
  return value;
}
// The actual Site ticket implementation, with a fixture-only signing key.
const ticketSource = fs.readFileSync(path.join(ROOT, 'site/lib/passes.js'), 'utf8');
const sign = text => crypto.createHmac('sha256', siteKey).update(text).digest('base64url');
const siteBox = { Buffer, Date, sign, sameSecret: (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y);
} };
vm.createContext(siteBox);
vm.runInContext(fn(ticketSource, 'makeTicket') + '\n' + fn(ticketSource, 'readTicket') +
  '\nthis.ticketApi={makeTicket,readTicket};', siteBox);
const tickets = siteBox.ticketApi;
const owner = new Map([[PID, A]]), asks = [];
const site = http.createServer((req, res) => {
  let raw = '';
  req.on('data', data => { raw += data; });
  req.on('end', () => {
    const doc = JSON.parse(raw || '{}'); asks.push({ ticket: doc.ticket, profileId: doc.profileId });
    let allowed = false, why = 'ticket';
    if (doc.ticket === 'site-approved-opaque-legacy' && doc.profileId === LEGACY) allowed = true;
    else {
      const authenticated = tickets.readTicket(doc.ticket);
      if (authenticated) {
        why = authenticated.d === DENIED ? 'role' : 'somebody else';
        allowed = authenticated.d !== DENIED && owner.get(doc.profileId) === authenticated.d;
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(allowed ? { ok: true, why: 'theirs' } : { ok: false, why }));
  });
});

// Wrappers leave actual return values/predicates intact. The child exposes
// snapshots ONLY over its test IPC pipe, never a client/network endpoint.
const observation = `
const __probeSpends=[];
const __probeSpend=spendToken;
spendToken=function(raw,...rest){
 const result=__probeSpend(raw,...rest);
 __probeSpends.push({tokenHash:crypto.createHash('sha256').update(String(raw)).digest('hex'),
   profileId:result.profileId,why:result.why||'',account:typeof result.account==='string'?result.account:null});
 return result;
};
const __probeDateNow=Date.now.bind(Date);let __probeOffset=0;
Date.now=()=>__probeDateNow()+__probeOffset;
process.on('message',async m=>{
 if(m.kind==='advance')__probeOffset+=m.ms;
 if(m.kind==='state'||m.kind==='advance')process.send({id:m.id,state:{now:Date.now(),lifetime:TOKEN_LIFETIME_MS,
   spends:__probeSpends,peers:[...peers].map(([id,p])=>({id,profileId:p.profileId,account:typeof p.account==='string'?p.account:null,muted:!!silencedLeft(p.profileId,Date.now(),p)})),
   speech:[...peers].map(([,p])=>({profileId:p.profileId,...voiceOf(p.profileId)}))}});
 if(m.kind==='stop'){await stop();process.send({id:m.id,stopped:true},()=>process.disconnect());}
});
process.send({probeReady:true});
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4640-'));
fs.writeFileSync(path.join(dir, 'voice-server.js'), source + '\n' + observation);
fs.copyFileSync(path.join(ROOT, 'voice/headlines.js'), path.join(dir, 'headlines.js'));
fs.writeFileSync(path.join(dir, 'token-key.txt'), key);
let current = null, queryId = 0;
const children = [], sockets = [], published = [], logs = [];
async function until(predicate, name, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() >= end) throw Error('deadline: ' + name);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function start() {
  const env = { THORNSWOOD_SITE: 'http://127.0.0.1:' + site.address().port, THORNSWOOD_VOICE_PORT: '0',
    THORNSWOOD_VOICE_BIND: '127.0.0.1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'), TEMP: dir, TMP: dir };
  for (const name of ['SystemRoot', 'WINDIR']) if (process.env[name]) env[name] = process.env[name];
  const kid = fork(path.join(dir, 'voice-server.js'), [], { cwd: dir, env, silent: true });
  const run = { kid, port: 0, ready: false, pending: new Map() }; children.push(run);
  const output = data => {
    const text = String(data); logs.push(text);
    const match = /\[voice\] listening on \S+:(\d+)/.exec(text); if (match) run.port = Number(match[1]);
  };
  kid.stdout.on('data', output); kid.stderr.on('data', output);
  kid.on('message', m => {
    if (m.probeReady) run.ready = true;
    if (run.pending.has(m.id)) { run.pending.get(m.id)(m); run.pending.delete(m.id); }
  });
  await until(() => run.port && run.ready, 'owned voice startup', 10000);
  current = run; return run;
}
async function ipc(kind, extra = {}, run = current) {
  const id = ++queryId;
  return new Promise((resolve, reject) => {
    const late = setTimeout(() => { run.pending.delete(id); reject(Error('private IPC deadline')); }, 3000);
    run.pending.set(id, value => { clearTimeout(late); resolve(value.state || value); });
    run.kid.send({ id, kind, ...extra });
  });
}
function request(route, doc, method = 'POST') {
  return new Promise((resolve, reject) => {
    const raw = doc === undefined ? '' : JSON.stringify(doc);
    const req = http.request({ host: '127.0.0.1', port: current.port, path: route, method, agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } }, res => {
      let text = ''; res.on('data', d => { text += d; }); res.on('end', () => {
        let value = null; try { value = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, value, text });
      });
    });
    req.setTimeout(3000, () => req.destroy(Error('HTTP fixture deadline')));
    req.on('error', reject); req.end(raw);
  });
}
async function token(profileId, ticket, extra = {}) { return request('/token', { profileId, ticket, ...extra }); }
function join(raw, profileId, extra = {}) {
  return new Promise(resolve => {
    const ws = new WebSocket('ws://127.0.0.1:' + current.port, ['thornswood', raw]); sockets.push(ws);
    const frames = [], value = { ws, accepted: false, refused: false, frames };
    const late = setTimeout(() => { try { ws.close(); } catch (_) {} resolve(value); }, 3000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', profileId, name: 'Fixture ' + profileId, ...extra }));
    ws.onmessage = event => {
      const frame = JSON.parse(event.data); frames.push(frame); published.push(frame);
      if (frame.t === 'welcome') { value.accepted = true; value.peer = frame.peer; clearTimeout(late); resolve(value); }
    };
    ws.onerror = () => { value.refused = true; clearTimeout(late); resolve(value); };
  });
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function privateAssociation(raw, peer) {
  const state = await ipc('state');
  return { spend: state.spends.find(s => s.tokenHash === hash(raw)), peer: state.peers.find(p => p.id === peer) };
}
async function close(ws) {
  if (ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => { ws.addEventListener('close', resolve, { once: true }); ws.close(); setTimeout(resolve, 1000); });
}
async function halt(run) {
  if (run.kid.exitCode !== null) return;
  await ipc('stop', {}, run);
  await until(() => run.kid.exitCode !== null, 'owned voice stop');
}

(async () => {
  try {
    await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
    await start();
    const good = tickets.makeTicket(A, 'Synthetic A');
    const other = tickets.makeTicket(B, 'Synthetic B');
    const denied = tickets.makeTicket(DENIED, 'Synthetic denied');
    const expiredBody = Buffer.from(JSON.stringify({ d: A, x: Date.now() - 1000 })).toString('base64url');
    const expiredTicket = 'tk1.' + expiredBody + '.' + sign('ticket:' + expiredBody);
    const altered = good.split('.');
    altered[1] = Buffer.from(JSON.stringify({ d: B, n: 'tampered', x: Date.now() + 60000 })).toString('base64url');
    const privateValues = [A, B, DENIED, good, other, denied, expiredTicket, altered.join('.'), 'site-approved-opaque-legacy'];
    for (const [name, supplied] of [['denied account', denied], ['mismatched owner', other],
      ['tampered signed payload', altered.join('.')], ['expired signed ticket', expiredTicket]]) {
      const r = await token(PID, supplied);
      check(name + ' obtains no token or peer association', r.status === 403 && !r.value?.token && (await ipc('state')).peers.length === 0);
    }
    const first = await token(PID, good, { account: B });
    check('approved token retains exact opaque v2 client shape', first.status === 200 && /^v2\.2001\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(first.value?.token) &&
      Object.keys(first.value).sort().join(',') === 'profileId,token,until');
    const one = await join(first.value.token, PID, { account: B, ticket: other });
    check('verified token still joins despite untrusted extra identity fields', one.accepted);
    const boundA = await privateAssociation(first.value.token, one.peer);
    check('approved ticket binds account privately to the spent nonce', boundA.spend?.account === A);
    check('peer uses nonce identity rather than client-supplied identity', boundA.peer?.account === A);
    const replay = await join(first.value.token, PID);
    check('spent nonce is refused without creating another peer', replay.refused && (await ipc('state')).peers.length === 1);

    // Same profile later changes ownership. Its next nonce must not overwrite
    // the immutable account associated with the existing connection.
    const pendingA = await token(PID, good);
    owner.set(PID, B);
    const second = await token(PID, other);
    const delayed = await join(pendingA.value.token, PID);
    const delayedContext = await privateAssociation(pendingA.value.token, delayed.peer);
    check('an unspent nonce retains its account across later mints for the same profile', delayedContext.spend?.account === A && delayedContext.peer?.account === A);
    const two = await join(second.value.token, PID);
    const boundB = await privateAssociation(second.value.token, two.peer);
    check('a different nonce carries its own newly authenticated account', boundB.spend?.account === B && boundB.peer?.account === B);
    check('existing peer keeps its original account after later ownership', (await privateAssociation(first.value.token, one.peer)).peer?.account === A);
    const legacy = await token(LEGACY, 'site-approved-opaque-legacy');
    const old = await join(legacy.value.token, LEGACY, { account: A });
    const legacyContext = await privateAssociation(legacy.value.token, old.peer);
    check('Site-approved opaque format still mints and joins unassociated', legacy.status === 200 && old.accepted && legacyContext.spend?.account === null && legacyContext.peer?.account === null);
    check('Site receives the exact original ticket, never a reconstructed identity', asks.some(a => a.ticket === good && a.profileId === PID));

    await request('/positions', { who: [PID, LEGACY].map((profileId, i) => ({ profileId, pos: [i, 0, 0], angleZ: 0, cell: 'fixture', name: 'Fixture ' + profileId })) });
    await until(() => published.some(f => f.t === 'peers' && f.peers.length > 0), 'actual public roster with connected peers');
    check('actual roster is exercised', published.some(f => f.t === 'peers' && f.peers.length > 0));
    await request('/silenced', { profiles: { [PID]: Date.now() + 60000 } });
    one.ws.send(JSON.stringify({ t: 'talk', on: true }));
    one.ws.send(JSON.stringify({ t: 'chat', text: '/help' }));
    let queue;
    await until(async () => {
      queue = await request('/commands?ack=1', undefined, 'GET');
      return queue.value?.commands?.some(c => c.text === '/help');
    }, 'command transport while silenced');
    check('existing character silence still suppresses speech', (await ipc('state')).speech.filter(p => p.profileId === PID).every(p => p.talk === false));
    check('ordinary slash command transport remains available while silenced', queue.value?.commands?.some(c => c.text === '/help'));
    await request('/silenced', { profiles: {} });
    one.ws.send(JSON.stringify({ t: 'talk', on: true }));
    await until(() => one.frames.some(f => f.t === 'hush' && f.on === false), 'existing unmute');
    check('existing unmute protocol remains unchanged', one.frames.some(f => f.t === 'hush' && f.on === false));

    const deadline = Date.now() + 60000;
    const applied = await request('/silenced', { profiles: {}, accountProtocol: 1, accountRevision: 1, accounts: { [A]: deadline } });
    check('account snapshot acknowledges its exact protocol and revision privately', applied.status === 200 && applied.value?.accountProtocol === 1 && applied.value?.accountRevision === 1);
    const active = await ipc('state');
    check('matching already-connected peers are silenced by immutable account', active.peers.filter(p => p.account === A).every(p => p.muted));
    const cacheFile = path.join(dir, 'chat/.account-silences.json'), heldCache = cacheFile + '.held';
    fs.renameSync(cacheFile, heldCache); fs.mkdirSync(cacheFile);
    try {
      const identical = await request('/silenced', { profiles: { [PID]: deadline }, accountProtocol: 1, accountRevision: 1, accounts: { [A]: deadline } });
      check('identical persisted revision needs no cache write and still applies character updates', identical.status === 200 &&
        identical.value?.accountRevision === 1 && (await ipc('state')).peers.find(p => p.id === two.peer)?.muted === true);
    } finally { fs.rmdirSync(cacheFile); fs.renameSync(heldCache, cacheFile); }
    await request('/silenced', { profiles: {}, accountProtocol: 1, accountRevision: 1, accounts: { [A]: deadline } });
    check('a different verified account stays free even with the same profile number', active.peers.find(p => p.id === two.peer)?.muted === false);
    check('an unbound peer retains its connection but cannot bypass active account moderation', active.peers.find(p => p.id === old.peer)?.muted === true && old.ws.readyState === WebSocket.OPEN && applied.value?.accountReady === false);
    const beforeAccount = published.length;
    one.ws.send(JSON.stringify({ t: 'chat', text: 'account-muted-line' }));
    two.ws.send(JSON.stringify({ t: 'chat', text: 'other-account-line' }));
    one.ws.send(JSON.stringify({ t: 'chat', text: '/help account-probe' }));
    await until(() => published.slice(beforeAccount).some(f => f.t === 'chat' && f.text === 'other-account-line'), 'unrelated account chat remains live');
    check('account silence suppresses actual chat without suppressing the unrelated account', !published.slice(beforeAccount).some(f => f.text === 'account-muted-line'));
    await until(async () => (await request('/commands?ack=1', undefined, 'GET')).value?.commands?.some(c => c.text === '/help account-probe'), 'account-silenced slash command transport');
    check('account-silenced ordinary command transport remains usable', true);
    const invalid = await request('/silenced', { profiles: { [PID]: deadline }, accountProtocol: 1, accountRevision: 2, accounts: { bad: deadline } });
    check('invalid account snapshot refuses atomically and never changes profile controls', invalid.status === 409 && (await ipc('state')).peers.find(p => p.id === two.peer)?.muted === false);
    const staleSnapshot = await request('/silenced', { profiles: {}, accountProtocol: 1, accountRevision: 0, accounts: {} });
    check('a stale snapshot cannot erase an applied account silence', staleSnapshot.status === 409 && (await ipc('state')).peers.find(p => p.id === one.peer)?.muted === true);
    const conflict = await request('/silenced', { profiles: {}, accountProtocol: 1, accountRevision: 1, accounts: {} });
    check('same-revision conflicting account snapshot cannot clear a silence', conflict.status === 409 && (await ipc('state')).peers.find(p => p.id === one.peer)?.muted === true);
    const tooLarge = await request('/silenced', { profiles: {}, accountProtocol: 1, accountRevision: 2, accounts: {}, padding: 'x'.repeat(20000) });
    check('original 20000-byte limit refuses without clearing an applied silence', tooLarge.status === 413 && (await ipc('state')).peers.find(p => p.id === one.peer)?.muted === true);
    const cacheGet = await request('/chat/.account-silences.json', undefined, 'GET');
    check('private silence cache is never exposed over HTTP', cacheGet.status === 404 && !cacheGet.text.includes(A));
    await request('/silenced', { profiles: {} });
    check('old gamemode profile publication cannot downgrade an account silence', (await ipc('state')).peers.find(p => p.id === one.peer)?.muted === true);
    const cleared = await request('/silenced', { profiles: {}, accountProtocol: 1, accountRevision: 2, accounts: {} });
    check('explicit newer empty account snapshot restores every affected connection', cleared.status === 200 && (await ipc('state')).peers.every(p => !p.muted));
    const visibility = JSON.stringify(published) + logs.join('');
    check('no account or ticket leaks into logs, welcome, roster or client frames', !privateValues.some(s => visibility.includes(s)) && !/"account(?:Id)?"\s*:/.test(JSON.stringify(published)));
    await close(one.ws);
    await until(async () => !(await ipc('state')).peers.some(p => p.id === one.peer), 'closed peer removal');
    check('closed session removes its private peer context', !(await ipc('state')).peers.some(p => p.id === one.peer));
    const tampered = second.value.token.slice(0, -1) + (second.value.token.endsWith('A') ? 'B' : 'A');
    const badMac = await join(tampered, PID);
    const rejected = (await ipc('state')).spends.find(s => s.tokenHash === hash(tampered));
    check('tampered token cannot create a private association', badMac.refused && rejected?.account === null && !!rejected?.why);

    // A valid old-format nonce with no optional issue metadata must remain
    // usable as a profile-only connection. The fixture owns this signing key.
    const clock = await ipc('state');
    const body = 'v2.' + LEGACY + '.' + clock.now + '.' + crypto.randomBytes(16).toString('base64url');
    const oldToken = body + '.' + crypto.createHmac('sha256', key).update(body).digest('base64url');
    const oldNonce = await join(oldToken, LEGACY, { account: B });
    const oldContext = await privateAssociation(oldToken, oldNonce.peer);
    check('valid legacy nonce stays usable without inventing an account', oldNonce.accepted && oldContext.spend?.account === null && oldContext.peer?.account === null);
    const beforeRestart = await token(PID, other);
    const restartDeadline = Date.now() + 60000;
    await request('/silenced', { profiles: {}, accountProtocol: 1, accountRevision: 3, accounts: { [A]: restartDeadline } });
    for (const ws of sockets) await close(ws);
    await halt(current); await start();
    const stale = await join(beforeRestart.value.token, PID);
    const staleContext = (await ipc('state')).spends.find(s => s.tokenHash === hash(beforeRestart.value.token));
    check('service restart never reuses a prior nonce association', stale.refused && staleContext?.account === null && /before this service/.test(staleContext?.why || ''));
    owner.set(PID, A);
    const reconnectToken = await token(PID, good), reconnect = await join(reconnectToken.value.token, PID);
    check('restart and reconnect retain an active account silence without gamemode republishing', reconnect.accepted && (await ipc('state')).peers.find(p => p.id === reconnect.peer)?.muted === true);
    await ipc('advance', { ms: 61000 });
    check('account silence expires at its original deadline after restart', (await ipc('state')).peers.find(p => p.id === reconnect.peer)?.muted === false);
    const lowerAfterRestart = await request('/silenced', { profiles: {}, accountProtocol: 1, accountRevision: 2, accounts: {} });
    check('restart retains account snapshot revision fencing even after expiry', lowerAfterRestart.status === 409);
    owner.set(PID, B);
    const expiring = await token(PID, other), lifetime = (await ipc('state')).lifetime;
    await ipc('advance', { ms: lifetime + 1000 });
    const expired = await join(expiring.value.token, PID);
    const expiredContext = (await ipc('state')).spends.find(s => s.tokenHash === hash(expiring.value.token));
    check('expired nonce cannot create or reuse a private association', expired.refused && expiredContext?.account === null && /expired/.test(expiredContext?.why || ''));
    const finalVisibility = JSON.stringify(published) + logs.join('');
    check('denial/replay/restart logs also contain no account or ticket', !privateValues.some(s => finalVisibility.includes(s)));
  } catch (error) {
    check('fixture completed without infrastructure failure: ' + error.message, false);
  } finally {
    for (const ws of sockets) try { ws.close(); } catch (_) {}
    for (const run of children) {
      try { await halt(run); } catch (_) { run.kid.kill(); await until(() => run.kid.exitCode !== null, 'owned child termination').catch(() => {}); }
    }
    site.closeAllConnections(); await new Promise(resolve => site.close(resolve));
    const absolute = path.resolve(dir), parent = path.resolve(os.tmpdir()) + path.sep;
    if (!absolute.startsWith(parent) || !path.basename(absolute).startsWith('thornswood-4640-')) throw Error('fixture cleanup boundary');
    fs.rmSync(absolute, { recursive: true });
  }
  console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})();
