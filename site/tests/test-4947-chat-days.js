'use strict';
// Actual loaded site modules and real day files in an owned scratch process.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), { spawn } = require('node:child_process'), { once } = require('node:events');
const siteFiles = require('../../tests/site-files');
const parent = fs.realpathSync(os.tmpdir()), dir = fs.mkdtempSync(path.join(parent, 'tw4947-'));
let child, serial = 0, pass = 0, fail = 0;
function yes(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }
function preload() {
  const fs = require('node:fs'), path = require('node:path');
  const read = fs.readFileSync.bind(fs); let reads = [];
  fs.readFileSync = (file, ...args) => {
    if (String(file).startsWith(path.join(__dirname, 'chat') + path.sep) || String(file).startsWith(path.join(__dirname, 'chat-dev') + path.sep)) reads.push(path.basename(String(file)));
    return read(file, ...args);
  };
  process.on('message', message => {
    reads = [];
    try {
      const logs = require('./lib/serverlogs'), retained = require('./lib/retention');
      const result = message.kind === 'copy' ? retained.copyKeptChat(message.row, message.now)
        : logs.chatSlice(message.profile, message.from === 'NaN' ? NaN : message.from, message.to, message.channel);
      process.send({ id: message.id, result, reads });
    } catch (error) { process.send({ id: message.id, error: error.stack }); }
  });
}
function call(message) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.off('message', receive); reject(Error('fixture module call timed out')); }, 10000);
    function receive(answer) {
      if (answer.id !== id) return;
      clearTimeout(timer); child.off('message', receive);
      answer.error ? reject(Error(answer.error)) : resolve(answer);
    }
    child.on('message', receive); child.send({ id, ...message });
  });
}
const stamp = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
function dayName(at) {
  const date = new Date(at), pad = value => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + '.jsonl';
}
function putLine(at, text, channel = 'main', profile = 7) {
  const folder = channel === 'dev' ? 'chat-dev' : 'chat';
  const line = { at, profileId: profile, name: 'Fixture', kind: 'say', mode: 'local', proven: true, text };
  fs.appendFileSync(path.join(dir, folder, dayName(at)), JSON.stringify(line) + '\n');
}
(async () => {
  const oldTZ = process.env.TZ; process.env.TZ = 'America/Denver';
  try {
    siteFiles.copy(dir, process.argv[2]);
    for (const folder of ['data', 'chat', 'chat-dev']) fs.mkdirSync(path.join(dir, folder), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ secret: crypto.randomBytes(32).toString('hex'),
      password: crypto.randomBytes(16).toString('hex'), admins: [], discord: { botToken: '', guildId: '', clientId: '', clientSecret: '' }, gameCheckPort: 1 }));
    fs.writeFileSync(path.join(dir, 'fixture.js'), '(' + preload.toString() + ')();');
    child = spawn(process.execPath, ['-r', path.join(dir, 'fixture.js'), path.join(dir, 'server.js')], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_DOCS_PORT: '0',
        THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'), THORNSWOOD_DEV_CHAT_DIR: path.join(dir, 'chat-dev') }
    });
    let stderr = ''; child.stderr.on('data', data => { stderr += data; }); await siteFiles.listening(child);
    const start = stamp(2026, 11, 1, 21), middle = stamp(2026, 11, 2, 12), end = stamp(2026, 11, 3, 2);
    putLine(start - 61000, 'outside before'); putLine(start, 'first'); putLine(middle, 'middle'); putLine(end, 'last');
    putLine(end + 61000, 'outside after'); putLine(middle, 'other person', 'main', 8); putLine(middle, 'dev middle', 'dev');
    let answer = await call({ profile: 7, from: start, to: end, channel: 'main' });
    yes('three-day slice includes every day in chronological order and exact profile/window', JSON.stringify(answer.result.lines.map(row => row.text)) === JSON.stringify(['first', 'middle', 'last']));
    yes('each day is read once, including the middle day', JSON.stringify(answer.reads) === JSON.stringify(['2026-11-01.jsonl', '2026-11-02.jsonl', '2026-11-03.jsonl']));
    yes('an existing day file keeps the normal empty-reason contract', answer.result.why === '');
    answer = await call({ profile: 7, from: start, to: end, channel: 'dev' });
    yes('dev uses only its own day files including a middle-only day', answer.result.lines.length === 1 && answer.result.lines[0].text === 'dev middle' && answer.result.why === '');
    const file = path.join(dir, 'chat/2026-11-02.jsonl'), saved = fs.readFileSync(file);
    fs.unlinkSync(file); answer = await call({ profile: 7, from: start, to: end, channel: 'main' });
    yes('a missing middle file does not hide available endpoint days', JSON.stringify(answer.result.lines.map(row => row.text)) === JSON.stringify(['first', 'last']));
    fs.writeFileSync(file, saved);
    for (const [label, firstDay, midDay, lastDay, hours] of [
      ['spring', [2026, 3, 7], [2026, 3, 8], [2026, 3, 9], 23],
      ['fall', [2026, 10, 31], [2026, 11, 1], [2026, 11, 2], 25]
    ]) {
      const from = stamp(...firstDay, 21), mid = stamp(...midDay, 12), to = stamp(...lastDay, 2);
      putLine(from, label + ' first', 'main', 9); putLine(mid, label + ' middle', 'main', 9); putLine(to, label + ' last', 'main', 9);
      yes(label + ' fixture actually crosses the local DST day', (stamp(...lastDay) - stamp(...midDay)) / 3600000 === hours);
      answer = await call({ profile: 9, from, to, channel: 'main' });
      yes(label + ' calendar iteration visits every date once across DST', JSON.stringify(answer.result.lines.map(row => row.text)) === JSON.stringify([label + ' first', label + ' middle', label + ' last']) && answer.reads.length === 3 && new Set(answer.reads).size === 3);
    }
    const session = 'chat4947kept00001', row = { session, profile: 7, who: 'fixture', channel: 'main', start, end, keep: true };
    answer = await call({ kind: 'copy', row, now: Date.now() });
    const kept = JSON.parse(fs.readFileSync(path.join(dir, 'data/session-logs', session + '.json'), 'utf8'));
    yes('actual kept-chat writer copies all three days with its existing minute margins', answer.result === 'copied'
      && JSON.stringify(kept.chat.lines.map(line => line.text)) === JSON.stringify(['first', 'middle', 'last']) && kept.chat.from === start - 60000 && kept.chat.to === end + 60000);
    yes('the kept snapshot hash matches all retained lines', kept.chat.sha256 === crypto.createHash('sha256').update(JSON.stringify(kept.chat.lines), 'utf8').digest('hex'));
    answer = await call({ kind: 'copy', row, now: Date.now() });
    yes('an already current kept snapshot stays unchanged without reading chat again', answer.result === 'already' && answer.reads.length === 0);
    const openSession = 'chat4947open00001';
    answer = await call({ kind: 'copy', row: { ...row, session: openSession, end: 0 }, now: end });
    const open = JSON.parse(fs.readFileSync(path.join(dir, 'data/session-logs', openSession + '.json'), 'utf8'));
    yes('initial kept copy of an open session also includes every day through now', answer.result === 'copied'
      && JSON.stringify(open.chat.lines.map(line => line.text)) === JSON.stringify(['first', 'middle', 'last']) && open.chat.to === end + 60000);
    for (const window of [{ from: end, to: start }, { from: 'NaN', to: end }, { from: start, to: 1e20 }]) {
      answer = await call({ profile: 7, channel: 'main', ...window });
      yes('invalid/reversed window refuses iteration and file reads', answer.result.lines.length === 0 && answer.reads.length === 0);
    }
    answer = await call({ profile: 7, from: stamp(2025, 1, 1), to: stamp(2025, 1, 3), channel: 'main' });
    yes('missing logs keep the existing unavailable reason', answer.result.lines.length === 0 && /no chat log/.test(answer.result.why));
    for (let i = 0; i < 4010; i++) putLine(middle + i, 'bounded ' + i, 'main', 11);
    putLine(end, 'after bounded middle day', 'main', 11);
    answer = await call({ profile: 11, from: start, to: end, channel: 'main' });
    yes('the existing output bound still stops inside a middle day before reading later dates', answer.result.lines.length === 4001
      && answer.result.lines.every(line => line.text.startsWith('bounded ')) && answer.reads.length === 2);
    yes('owned site remains healthy', child.exitCode === null && !/uncaught exception|unhandled rejection/.test(stderr));
  } catch (error) { fail++; console.error(error.stack || error); }
  finally {
    if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ;
    if (!path.resolve(dir).startsWith(parent + path.sep)) throw Error('refusing cleanup outside owned temp folder');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})();
