'use strict';
// Actual writer child streams -> actual session reader and retention, on a private clock.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), Module = require('module');
const root = path.resolve(__dirname, '..'), writer = path.join(root, 'scripts/vps/Server-Log.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4948-'));
let pass = 0, fail = 0;
function yes(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }
const first = Date.parse('2026-11-01T07:25:00.000Z'), second = Date.parse('2026-11-01T08:25:00.000Z');
const between = first + 100, completed = first + 200;
const log = path.join(dir, 'server.log'), clock = path.join(dir, 'clock'), preload = path.join(dir, 'clock.js');
const program = path.join(dir, 'child.js');
function reader(tz) {
  const runner = path.join(dir, 'read-' + tz.replace(/\W/g, '') + '.js');
  fs.writeFileSync(runner, `
    const fs=require('fs'),Module=require('module');
    const filename=${JSON.stringify(path.join(root, 'site/lib/serverlogs.js'))};
    const source=fs.readFileSync(filename,'utf8').replace(/const SERVER_LOGS = \\{[\\s\\S]*?\\};/, 'const SERVER_LOGS = '+JSON.stringify({main:${JSON.stringify(log)},dev:${JSON.stringify(path.join(dir, 'dev.log'))}})+';');
    const m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(require('path').dirname(filename));
    m.require=id=>id==='./store'?{jsonFile:()=>({})}:id==='./discord'?{LINKED:''}:require(id);
    m._compile(source,filename);
    console.log(JSON.stringify([m.exports.serverLogSlice('main',${first - 1000},${first + 1000}),m.exports.serverLogSlice('main',${second - 1000},${second + 1000}),m.exports.serverLogSlice('dev',${first - 1000},${second + 1000})]));
  `);
  const got = cp.spawnSync(process.execPath, [runner], { encoding: 'utf8', env: { ...process.env, TZ: tz }, timeout: 15000 });
  if (got.status !== 0) throw new Error(got.stderr || got.stdout);
  return JSON.parse(got.stdout);
}
try {
  fs.writeFileSync(clock, String(first));
  fs.writeFileSync(preload, `const fs=require('fs'),RealDate=Date;global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[Number(fs.readFileSync(process.env.CLOCK_FILE,'utf8'))]));}static now(){return Number(fs.readFileSync(process.env.CLOCK_FILE,'utf8'));}};`);
  fs.writeFileSync(program, `
    const fs=require('fs');const clock=${JSON.stringify(clock)},log=${JSON.stringify(log)};
    function waitFor(word,next,n=0){if(n>400)throw new Error('writer did not record '+word);if(fs.existsSync(log)&&fs.readFileSync(log,'utf8').includes(word))next();else setTimeout(()=>waitFor(word,next,n+1),10);}
    process.stdout.write('[2026-11-01 01:25:00.000] FIRST-PART');
    setTimeout(() => {
      fs.writeFileSync(clock, '${between}');
      process.stderr.write('[1999-01-01T00:00:00.000Z] INTERLEAVED-STDERR\\n');
    }, 100);
    waitFor('INTERLEAVED-STDERR', () => {
      fs.writeFileSync(clock, '${completed}');
      process.stdout.write('-TAIL\\r\\n');
      waitFor('FIRST-PART-TAIL', () => {
        fs.writeFileSync(clock,${JSON.stringify(String(second))});
        process.stderr.write('[2026-11-01 01:25:00.000] SECOND-HOUR\\n');
        waitFor('SECOND-HOUR', () => {
          process.stdout.write('    final stack fragment');
          process.stderr.write('    final stderr fragment');
        });
      });
    });
  `);
  const run = cp.spawnSync(process.execPath, ['--require', preload, writer, '--log', log, program], {
    cwd: dir, encoding: 'utf8', timeout: 15000, env: { ...process.env, TZ: 'America/Denver', CLOCK_FILE: clock }
  });
  yes('the actual writer handles split stdout and stderr and exits', run.status === 0);
  const text = fs.readFileSync(log, 'utf8');
  yes('the first repeated hour has the receipt time of the complete CRLF line', text.includes('[2026-11-01T07:25:00.200Z] [2026-11-01 01:25:00.000] FIRST-PART-TAIL\r\n'));
  yes('the second repeated hour has a distinct UTC stamp despite the same embedded event clock', text.includes('[2026-11-01T08:25:00.000Z] [2026-11-01 01:25:00.000] SECOND-HOUR\n'));
  const exitAt = text.indexOf('[server-log] the server ended');
  yes('an unterminated fragment on each pipe has its own UTC stamp before the exit record',
    exitAt >= 0 && ['stack', 'stderr'].every(kind =>
      text.slice(0, exitAt).includes('[2026-11-01T08:25:00.000Z]     final ' + kind + ' fragment\n')));
  yes('stderr that completes between stdout fragments is stamped and kept separate in receipt order',
    text.includes('[2026-11-01T07:25:00.100Z] [1999-01-01T00:00:00.000Z] INTERLEAVED-STDERR\n') &&
    text.indexOf('INTERLEAVED-STDERR') < text.indexOf('FIRST-PART-TAIL'));
  yes('split chunks do not add another stamp within a line', (text.match(/FIRST-PART/g)||[]).length === 1 && text.includes('FIRST-PART-TAIL'));
  fs.writeFileSync(path.join(dir, 'dev.log'), '[2026-11-01T08:25:00.000Z] DEV-ONLY\n');
  // Exercise the real reader across the writer's own roll, retaining the original bytes.
  const W = require(writer); W.rollFile(log, second + 10000);
  fs.writeFileSync(log, '[2026-11-01T09:00:00.000Z] LATER-ONLY\n');
  for (const tz of ['America/Denver', 'UTC']) {
    const [a,b,dev] = reader(tz);
    yes(tz + ' first session reads only the first occurrence across a real roll', a.ok && a.lines.some(x=>x.includes('FIRST-PART-TAIL')) && !a.lines.some(x=>x.includes('SECOND-HOUR')||x.includes('LATER-ONLY')));
    yes(tz + ' second session reads only the second occurrence with its continuation', b.ok && b.lines.some(x=>x.includes('SECOND-HOUR')) && b.lines.some(x=>x.includes('final stack fragment')) && !b.lines.some(x=>x.includes('FIRST-PART')));
    yes(tz + ' channel selection remains isolated', dev.lines.length === 1 && dev.lines[0].includes('DEV-ONLY'));
  }
  const held = path.join(dir, 'retention.log.1');
  fs.writeFileSync(held, '[2026-11-01T07:25:00.000Z] EARLY\n    early stack\n[2026-11-01T08:25:00.000Z] LATE\n    late stack\n');
  W.trimFile(held, first + 30 * 60000);
  yes('retention uses the same unambiguous clock without dropping the later stack', fs.readFileSync(held,'utf8') === '[2026-11-01T08:25:00.000Z] LATE\n    late stack\n');
  // Old local-only files remain supported; their repeated hour cannot be reconstructed.
  const legacy = '[2026-10-30 12:25:00.000] LEGACY\n    legacy stack\n';
  fs.writeFileSync(held, legacy);
  yes('legacy local timestamps remain valid retention inputs', Number.isFinite(W.lineTime(legacy)) && W.trimFile(held, new Date(2026,9,30,12,24).getTime()) === 'kept');
  fs.writeFileSync(log, '[2026-11-01 01:25:00.000] LEGACY-READER\n    legacy continuation\n');
  const legacyRead = reader('America/Denver')[0];
  yes('the actual reader still selects legacy local text and its unstamped continuation', legacyRead.ok && legacyRead.lines.some(x=>x.includes('LEGACY-READER')) && legacyRead.lines.some(x=>x.includes('legacy continuation')));
  fs.writeFileSync(log, '[2026-11-01T07:25:00.000Z] interrupted prior run');
  fs.writeFileSync(program, "console.log('after-restart');");
  const restart = cp.spawnSync(process.execPath, ['--require', preload, writer, '--log', log, program], {
    cwd: dir, encoding: 'utf8', timeout: 15000, env: { ...process.env, TZ: 'America/New_York', CLOCK_FILE: clock }
  });
  const restarted = fs.readFileSync(log, 'utf8');
  yes('restart after an incomplete line separates the old and new receipt times', restart.status === 0 &&
    restarted.includes('interrupted prior run\n[2026-11-01T08:25:00.000Z] after-restart\n'));
  for (const tz of ['America/Denver', 'UTC', 'Europe/Berlin']) {
    const [a,b] = reader(tz);
    yes(tz + ' restart puts each line in its own session', a.ok && b.ok &&
      a.lines.some(x => x.includes('interrupted prior run')) && !a.lines.some(x => x.includes('after-restart')) &&
      b.lines.some(x => x.includes('after-restart')) && !b.lines.some(x => x.includes('interrupted prior run')));
  }
  const large = path.join(dir, 'large.log');
  fs.writeFileSync(program, 'process.stdout.write("X".repeat(' + (W.MAX_BYTES + 19) + ') + "\\n");');
  const ranLarge = cp.spawnSync(process.execPath, ['--require', preload, writer, '--log', large, program], {
    cwd: dir, encoding: 'utf8', timeout: 15000, env: { ...process.env, TZ: 'Australia/Sydney', CLOCK_FILE: clock }
  });
  const largeFiles = W.rolledFiles(large);
  const fragments = largeFiles.concat(large).flatMap(f => fs.readFileSync(f, 'utf8').split('\n'))
    .map(line => (/^\[2026-11-01T08:25:00\.000Z\] (X+)$/.exec(line) || [])[1]).filter(Boolean);
  yes('over-limit output rolls and keeps all bytes in two independently stamped fragments',
    ranLarge.status === 0 && largeFiles.length === 1 && fs.statSync(largeFiles[0]).size <= W.MAX_BYTES &&
    fragments.length === 2 && fragments.reduce((total, fragment) => total + fragment.length, 0) === W.MAX_BYTES + 19);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
