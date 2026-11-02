// CPU PROFILE ON REQUEST BEGIN
/*
  A CPU PROFILE OF THIS SERVER, WHEN THE BOX ASKS FOR ONE (#3181).

  Each game server used about a ninth of a core all day with nobody on, and
  nothing said where it went: the NPC activity, the saves it caused, or the
  engine's own loop. scripts\vps\Profile-GameServer.ps1 drops profile.json in
  the data folder over ssh, as Request-Restart.ps1 drops restart.json; this
  picks it up within five seconds, deletes it, and samples this process with
  node's own profiler for the seconds it asks (120 unless it says, 1 to
  600), once a millisecond. Then it writes two files beside it in
  profiles\: the whole profile (newest.cpuprofile, which Chrome's DevTools and
  VS Code open) and newest.txt, where the time went by function and by file.
  Each run replaces the last one's, so the folder never grows.

  In this process, through an inspector session of its own: no port is
  opened, nothing restarts, and nobody on the server notices more than the
  sampling, a few percent of one core while it runs.
*/
(function () {
  var fs = require('fs'), path = require('path');
  var dir = 'data';
  try {
    var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
    if (cfg && cfg.dataDir) { dir = String(cfg.dataDir); }
  } catch (e) { log('cpu profile: server-settings.json not read, so the request is looked for in data:', e); }
  var REQUEST = path.join(dir, 'profile.json'), OUT = path.join(dir, 'profiles');
  var running = false;

  // Self time by function and by file, from the samples' own time deltas.
  function summary(profile, secs, at) {
    var byNode = {}, nodes = profile.nodes || [], i;
    for (i = 0; i < nodes.length; i++) { byNode[nodes[i].id] = nodes[i]; }
    var self = {}, total = 0, samples = profile.samples || [], deltas = profile.timeDeltas || [];
    for (i = 0; i < samples.length; i++) {
      var us = deltas[i + 1] !== undefined ? deltas[i + 1] : 0;
      self[samples[i]] = (self[samples[i]] || 0) + us;
      total += us;
    }
    var fns = {}, files = {};
    Object.keys(self).forEach(function (id) {
      var n = byNode[id], f = n && n.callFrame;
      if (!f) { return; }
      // (idle), (program) and (garbage collector) name themselves; a frame
      // with no file is the engine's own code, the native addon among it.
      var file = f.url ? f.url.replace(/^.*[\\/]/, '') :
        (/^\(.*\)$/.test(f.functionName) ? f.functionName : '(native)');
      var fn = (f.functionName || '(anonymous)') + '  ' + file + (f.url ? ':' + (f.lineNumber + 1) : '');
      fns[fn] = (fns[fn] || 0) + self[id];
      files[file] = (files[file] || 0) + self[id];
    });
    function top(map, n) {
      return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).slice(0, n).map(function (k) {
        return ('     ' + (100 * map[k] / Math.max(total, 1)).toFixed(1)).slice(-6) + '%  ' + (map[k] / 1000).toFixed(0) + ' ms  ' + k;
      });
    }
    var idle = (files['(idle)'] || 0), busy = total - idle;
    return ['cpu profile of ' + secs + ' s, taken ' + at,
      'sampled ' + (total / 1e6).toFixed(1) + ' s; busy ' + (busy / 1e6).toFixed(2) + ' s, ' +
        (busy / Math.max(total, 1)).toFixed(3) + ' of a core on the JavaScript thread',
      '', 'by file:'].concat(top(files, 25), ['', 'by function:'], top(fns, 60)).join('\r\n') + '\r\n';
  }

  function take(secs) {
    var inspector = require('inspector'), s = new inspector.Session(), at = new Date().toISOString();
    s.connect();
    function fail(where, err) { running = false; log('cpu profile failed at ' + where + ':', err); try { s.disconnect(); } catch (e) { log('cpu profile: the session did not close:', e); } }
    s.post('Profiler.enable', function (err) {
      if (err) { return fail('enable', err); }
      s.post('Profiler.setSamplingInterval', { interval: 1000 }, function (err2) {
        if (err2) { return fail('interval', err2); }
        s.post('Profiler.start', function (err3) {
          if (err3) { return fail('start', err3); }
          log('cpu profile: sampling for ' + secs + ' s');
          setTimeout(function () {
            s.post('Profiler.stop', function (err4, r) {
              if (err4) { return fail('stop', err4); }
              try {
                fs.mkdirSync(OUT, { recursive: true });
                fs.writeFileSync(path.join(OUT, 'newest.cpuprofile'), JSON.stringify(r.profile));
                fs.writeFileSync(path.join(OUT, 'newest.txt'), summary(r.profile, secs, at));
                log('cpu profile: written to ' + path.join(OUT, 'newest.txt'));
              } catch (e) { log('cpu profile: could not write it:', e); }
              running = false;
              s.disconnect();
            });
          }, secs * 1000);
        });
      });
    });
  }

  function check() {
    if (running || !fs.existsSync(REQUEST)) { return; }
    var raw = fs.readFileSync(REQUEST, 'utf8');
    // Deleted before it is acted on, so one left by a crash never fires twice.
    fs.unlinkSync(REQUEST);
    var req = {};
    try { req = JSON.parse(raw) || {}; } catch (e) { log('cpu profile request was not readable:', raw); return; }
    var secs = Math.round(Number(req.seconds) || 120);
    secs = Math.max(1, Math.min(600, secs));
    running = true;
    take(secs);
  }

  // Stored so a hot reload replaces it rather than adding another.
  if (globalThis.__thornswoodProfileTimer) { clearInterval(globalThis.__thornswoodProfileTimer); }
  globalThis.__thornswoodProfileTimer = setInterval(function () {
    try { check(); } catch (e) { running = false; log('cpu profile request threw:', e); }
  }, 5000);
})();
// CPU PROFILE ON REQUEST END


