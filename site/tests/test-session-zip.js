/*
  test-session-zip.js

  Download all on /sessions: every file of one session in one zip.

  Asked for by Patrick on 5 October, after a crash report took nine presses of
  Download and arrived as nine loose files. The zip is made in the browser by
  zipStore in site\public\hub.js, with no library, so the part worth a test is
  that what it writes is a zip any unzipper reads back byte for byte:

    - the CRC-32 is the one zip uses, checked against a known value and
      against Node's own zlib.crc32 where this Node has it;
    - every header points where it says it does: each local header at the
      offset its central entry gives, the central directory where the end
      record says, and the counts agree;
    - the text comes back exactly, names outside ASCII included, because the
      names are written as UTF-8 and flagged as such;
    - the files are the ones More details shows, in its order, under one
      folder named like the zip, and the provenance file carries the
      checksums the site took when the logs arrived.

  This lifts the real functions out of the shipped page by text, so a rename
  fails loudly rather than testing a copy of the logic.

  Read only. It opens one file and runs no server.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const src = fs.readFileSync(path.join(REPO_DIR, 'site', 'public', 'hub.js'), 'utf8');

function grab(name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('site/public/hub.js has no function ' + name);
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

eval(['crc32', 'dosStamp', 'zipStore', 'serverLogName', 'chatFileName', 'chatText',
      'sessionFiles', 'provenanceText', 'sessionZipStem', 'sessionAt', 'bytesFor']
  .map(grab).join('\n'));

let pass = 0, fail = 0;
const yes = (what, c) => {
  if (c) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
};

/* ---- the checksum ------------------------------------------------------- */
const ascii = new TextEncoder().encode('123456789');
yes('CRC-32 of "123456789" is cbf43926, the published check value', crc32(ascii) === 0xcbf43926);
yes('CRC-32 of nothing is 0', crc32(new Uint8Array(0)) === 0);
if (typeof zlib.crc32 === 'function') {
  const blob = crypto.randomBytes(70000);
  yes('CRC-32 agrees with zlib.crc32 on 70,000 random bytes', crc32(blob) === zlib.crc32(blob));
} else {
  console.log('SKIP  this Node has no zlib.crc32 to compare against');
}

/* ---- the time ----------------------------------------------------------- */
const t = new Date(2026, 9, 5, 11, 13, 26).getTime();
const st = dosStamp(t);
yes('the date field reads back as 5 October 2026',
    (st.date >> 9) + 1980 === 2026 && ((st.date >> 5) & 15) === 10 && (st.date & 31) === 5);
yes('the time field reads back as 11:13:26',
    (st.time >> 11) === 11 && ((st.time >> 5) & 63) === 13 && (st.time & 31) * 2 === 26);
const bad = dosStamp('not a time');
yes('a time that is not one becomes a real date rather than NaN', bad.date > 0 && bad.date === (bad.date & 0xffff));
yes('a date before 1980 is held at 1980', (dosStamp(new Date(1970, 0, 2).getTime()).date >> 9) === 0);

/* ---- reading a zip back, by its own records ----------------------------- */
function readZip(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const endAt = buf.length - 22;
  if (v.getUint32(endAt, true) !== 0x06054b50) throw new Error('no end record at the end');
  const count = v.getUint16(endAt + 10, true);
  const cdSize = v.getUint32(endAt + 12, true);
  const cdAt = v.getUint32(endAt + 16, true);
  if (cdAt + cdSize !== endAt) throw new Error('the central directory does not end where the end record starts');
  const out = [];
  let p = cdAt;
  const dec = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('central entry ' + i + ' has no signature');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    if (v.getUint32(lho, true) !== 0x04034b50) throw new Error(name + ': no local header at ' + lho);
    if (v.getUint32(lho + 14, true) !== crc) throw new Error(name + ': local and central CRC differ');
    const lnlen = v.getUint16(lho + 26, true);
    const lxlen = v.getUint16(lho + 28, true);
    const lname = dec.decode(buf.subarray(lho + 30, lho + 30 + lnlen));
    if (lname !== name) throw new Error(name + ': local header names ' + lname);
    const data = buf.subarray(lho + 30 + lnlen + lxlen, lho + 30 + lnlen + lxlen + csize);
    out.push({ name, flags, method, crc, csize, size, data });
    p += 46 + nlen + xlen + clen;
  }
  if (p !== endAt) throw new Error('the central directory has bytes left over');
  return out;
}

const files = [
  { name: 'launcher.log', text: '2026-10-05 13:54:44  Vortex deploys into c:\\program files\nline two\n' },
  { name: 'empty.txt', text: '' },
  { name: 'chat-1035774629.txt', text: 'Aemon Stark: hail, traveller \u2013 \u00e9t\u00e9, \u65e5\u672c\n' },
  { name: 'f\u00f6lder/n\u00e4me.log', text: 'a name outside ASCII' }
];
const zipped = zipStore(files, t);
let back = [];
try { back = readZip(zipped); yes('the zip reads back by its own records', true); }
catch (e) { yes('the zip reads back by its own records: ' + e.message, false); }

yes('one entry per file, in the order given',
    back.length === files.length && back.every((b, i) => b.name === files[i].name));
yes('every entry is stored, flagged UTF-8, and its two sizes agree',
    back.every(b => b.method === 0 && (b.flags & 0x0800) && b.csize === b.size));
yes('every entry\'s text comes back exactly',
    back.every((b, i) => new TextDecoder().decode(b.data) === files[i].text));
yes('every entry\'s CRC matches its bytes', back.every(b => crc32(b.data) === b.crc));
yes('an empty file is an entry of nothing, not a missing one', back[1] && back[1].size === 0);
yes('a zip of no files is the 22-byte end record alone', zipStore([], t).length === 22);

/* ---- what goes in it ---------------------------------------------------- */
const row = { session: 'ed3c2087a51241bc9bd7216376f81712', who: '1', profile: 1035774629,
              start: new Date(2026, 9, 5, 11, 12, 53).getTime(), end: new Date(2026, 9, 5, 11, 13, 26).getTime() };
const d = {
  session: row.session,
  channel: 'main',
  client: { 'launcher.log': 'L', 'skyrim-platform.log': 'P' },
  server: ['[2026-10-05 11:13:16.767] connect 1', '[2026-10-05 11:14:17.439] disconnect 1'],
  chat: [{ at: row.start, name: 'Aemon Stark', text: 'hello', proven: true }],
  sent: { who: '615236910243119104', at: row.end, bytes: 2,
          sha256: { 'launcher.log': crypto.createHash('sha256').update('L').digest('hex'),
                    'skyrim-platform.log': crypto.createHash('sha256').update('P').digest('hex') },
          resent: 0 },
  keep: false
};
const got = sessionFiles(d, row);
yes('the files are the client logs, then the server log, then the chat, as More details shows them',
    got.map(f => f.name).join(',') === 'launcher.log,skyrim-platform.log,server-main.log,chat-1035774629.txt');
yes('the server log is the server lines, one to a line', got[2].text === d.server.join('\n'));
yes('a dev session\'s server log is named for dev', serverLogName({ channel: 'dev' }) === 'server-dev.log');
yes('the chat file carries who said it', got[3].text.indexOf('Aemon Stark: hello') >= 0);
yes('a session with nothing from that machine still has its server log',
    sessionFiles({ client: {}, server: ['x'], chat: [] }, row).map(f => f.name).join(',') === 'server-main.log');
yes('a session with nothing at all has no files', sessionFiles({}, row).length === 0);

const prov = provenanceText(row.session, d);
yes('provenance names the session and the Discord id off the ticket',
    prov.indexOf(row.session) >= 0 && prov.indexOf('615236910243119104') >= 0);
yes('provenance carries the checksum the site took for each log, and it is the checksum of the text in the zip',
    Object.keys(d.client).every(n => prov.indexOf(crypto.createHash('sha256').update(d.client[n]).digest('hex') + '  ' + n) >= 0));
yes('provenance says when somebody tried to send a second set',
    provenanceText(row.session, Object.assign({}, d, { sent: Object.assign({}, d.sent, { resent: 2 }) })).indexOf('2 time(s) and refused') >= 0);
yes('no provenance file without a sent record', provenanceText(row.session, { client: {} }) === '');

const stem = sessionZipStem(row.session, row);
yes('the zip is named by the session, the character and the day', stem === 'ed3c2087-1035774629-2026-10-05');
yes('a session with no character says so in the name',
    sessionZipStem('abcdefgh12', { start: row.start }) === 'abcdefgh-no-character-2026-10-05');
yes('a name is never anything but letters, digits, dot, dash and underscore',
    /^[A-Za-z0-9._-]+$/.test(sessionZipStem('ab/..\\cd:ef', { profile: 'x y', start: 0 })));

/* ---- the page ----------------------------------------------------------- */
yes('each session row has a Download all button beside More details',
    /moreBtn[^\n]*\n[\s\S]{0,200}zipBtn[^\n]*Download all/.test(src));
yes('the button is wired with the More details buttons', /function wireMore\(root\) \{\s*each\(root, 'button\.zipBtn'/.test(src));
yes('the zip goes out as application/zip', src.indexOf("{ type: 'application/zip' }") >= 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
